#!/usr/bin/env python3
"""
Refund — AI Reply Engine & Manager Escalation Server (reply_engine.py)
Runs on http://localhost:8080 with CORS enabled for browser fetch() calls.

Endpoints:
  - POST /reply          : Classifies customer message, checks scam/escalation flags,
                           evaluates refund policy, and returns a grounded reply.
  - POST /escalate       : Logs & dispatches the summarized Manager Escalation Email
  - POST /escalate-email : Alias for /escalate
"""

import json
import os
import re
import smtplib
import urllib.error
import urllib.request
from datetime import datetime
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

GROK_API_URL = os.environ.get("GROK_API_URL", "https://api.x.ai/v1/chat/completions")
GROK_MODEL = os.environ.get("GROK_MODEL", "grok-3-mini")

BUSINESS_JSON_PATH = Path(__file__).parent / "business.json"

DEFAULT_PROFILE = {
    "name": "Refund",
    "tone": "friendly, professional, concise",
    "signoff": "Kind regards,\nThe Refund Team",
    "currency": "R",
    "hours": {
        "Mon-Fri": "08:00-17:00",
        "Sat": "09:00-13:00",
        "Sun": "Closed",
    },
    "location": "123 Example Street, Sandton, Johannesburg",
    "contact": {
        "phone": "+27 11 000 0000",
        "email": "info@example.co.za",
        "whatsapp": "+27 82 000 0000",
    },
    "policies": {
        "refund": "A return is allowed when the order is yours and delivered, delivery was no more than 14 days ago, the item was not bought on sale, the quantity is not more than you bought, and there is no other open return for that item.",
        "delivery": "Delivery takes 2-5 working days within Gauteng.",
        "payment": "We accept EFT and card. We will never change our banking details by email or WhatsApp; always confirm by phone first.",
    },
    "escalate_keywords": [
        "lawyer",
        "legal action",
        "sue",
        "fraud",
        "chargeback",
        "media",
        "ombud",
    ],
}

# Patterns that indicate a possible payment redirect / credential harvesting scam
SCAM_PATTERNS = [
    r"\bchange\b.*\bbank(ing)?\s+details\b",
    r"\bnew\s+bank\s+account\b",
    r"\burgent\s+transfer\b",
    r"\bgift\s*cards?\b",
    r"\b(otp|pin|cvv|password)\b",
    r"\bpay\s+into\s+different\s+account\b",
    r"\bwhatsapp\s+new\s+account\b",
]

# Intent keyword dictionary
INTENT_PATTERNS = {
    "human": [
        r"\b(human|person|agent|manager|owner|someone|representative|speak to|talk to|appeal)\b"
    ],
    "complaint": [
        r"\b(unacceptable|terrible|worst|angry|furious|disgusted|scam|ripoff|pathetic|horrible|lawsuit|sue|ombud|chargeback)\b"
    ],
    "refund": [
        r"\b(refund|return|money back|reimburse|damaged|cold|wrong item|wrong size|defective|broken|missing|cancel)\b"
    ],
    "delivery": [
        r"\b(delivery|shipping|track|where is my order|eta|courier|arrived|late|took too long)\b"
    ],
    "payment": [
        r"\b(payment|eft|bank details|card|invoice|proof of payment|paid|charge)\b"
    ],
    "hours": [
        r"\b(hours|open|close|trading|weekend|sunday|saturday|time)\b"
    ],
    "location": [
        r"\b(where are you|address|location|sandton|johannesburg|branch|store)\b"
    ],
}


def load_business_profile() -> dict:
    if BUSINESS_JSON_PATH.exists():
        try:
            with open(BUSINESS_JSON_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            print(f"[ReplyEngine] Warning reading business.json: {exc}")
    return DEFAULT_PROFILE


def classify(text: str) -> tuple[str, float]:
    """
    Classify a customer message into (intent, confidence).
    """
    cleaned = (text or "").strip().lower()
    if not cleaned:
        return ("general", 0.35)

    scores = {}
    for intent, patterns in INTENT_PATTERNS.items():
        hits = 0
        for pat in patterns:
            matches = re.findall(pat, cleaned, flags=re.IGNORECASE)
            hits += len(matches)
        if hits > 0:
            scores[intent] = hits

    if not scores:
        return ("refund", 0.55)

    # Prioritize human / complaint if explicitly triggered
    if "human" in scores:
        return ("human", min(0.98, 0.75 + 0.1 * scores["human"]))
    if "complaint" in scores:
        return ("complaint", min(0.95, 0.72 + 0.1 * scores["complaint"]))

    best_intent = max(scores, key=scores.get)
    confidence = min(0.95, 0.65 + (scores[best_intent] * 0.12))
    return (best_intent, round(confidence, 2))


def flags(text: str, profile: dict) -> list[str]:
    """
    Check message against escalate_keywords and SCAM_PATTERNS.
    """
    lowered = (text or "").lower()
    detected = []

    for kw in profile.get("escalate_keywords", []):
        if kw.lower() in lowered:
            detected.append(f"escalate:{kw.lower()}")

    for pattern in SCAM_PATTERNS:
        if re.search(pattern, lowered, flags=re.IGNORECASE):
            detected.append("possible_scam_or_payment_redirect")
            break

    return detected


def facts_for(intent: str, profile: dict) -> list[str]:
    """
    Retrieve grounded business facts for the given intent.
    """
    policies = profile.get("policies", {})
    contact = profile.get("contact", {})
    hours = profile.get("hours", {})

    if intent == "refund":
        return [
            policies.get("refund", ""),
            f"Support contact: {contact.get('phone', '')} / {contact.get('email', '')}",
        ]
    if intent == "delivery":
        return [
            policies.get("delivery", ""),
            policies.get("refund", ""),
        ]
    if intent == "payment":
        return [
            policies.get("payment", ""),
        ]
    if intent == "hours":
        hours_str = ", ".join(f"{k}: {v}" for k, v in hours.items())
        return [f"Trading hours: {hours_str}", f"Location: {profile.get('location', '')}"]
    if intent == "location":
        return [f"Address: {profile.get('location', '')}"]
    if intent in ("human", "complaint"):
        return [
            f"Phone: {contact.get('phone', '')}",
            f"WhatsApp: {contact.get('whatsapp', '')}",
            f"Email: {contact.get('email', '')}",
        ]
    return [
        policies.get("refund", ""),
        policies.get("delivery", ""),
        policies.get("payment", ""),
    ]


def _draft(intent: str, facts: list[str], flags_list: list[str], profile: dict) -> str:
    """
    Draft a concise, policy-grounded response with the business signoff.
    """
    contact = profile.get("contact", {})
    policies = profile.get("policies", {})
    signoff = profile.get("signoff", "Kind regards,\nThe Refund Team")

    if "possible_scam_or_payment_redirect" in flags_list:
        body = (
            f"SECURITY NOTICE: {policies.get('payment', '')} "
            f"For your protection, we have flagged this request for human verification. "
            f"Please call us directly on {contact.get('phone', '+27 11 000 0000')}."
        )
        return f"{body}\n\n{signoff}"

    if intent in ("human", "complaint") or any(f.startswith("escalate:") for f in flags_list):
        body = (
            f"Of course. A team member will be with you shortly. "
            f"You can also call {contact.get('phone', '+27 11 000 0000')} "
            f"or WhatsApp {contact.get('whatsapp', '+27 82 000 0000')}."
        )
        return f"{body}\n\n{signoff}"

    if intent == "refund":
        body = (
            f"Thank you for reaching out to {profile.get('name', 'Refund')}. "
            f"{policies.get('refund', '')} "
            f"We have reviewed your proof of payment and order details below."
        )
        return f"{body}\n\n{signoff}"

    if intent == "delivery":
        body = f"{policies.get('delivery', '')} {policies.get('refund', '')}"
        return f"{body}\n\n{signoff}"

    if intent == "payment":
        body = f"{policies.get('payment', '')}"
        return f"{body}\n\n{signoff}"

    body = " ".join(f for f in facts if f)
    return f"{body}\n\n{signoff}"


def call_grok_api_for_refund(
    payload: dict,
    profile: dict,
    days_old: int,
    detected_flags: list[str],
    default_intent: str,
) -> dict | None:
    """
    Calls xAI Grok API (or Groq if a gsk_ key is provided) to evaluate whether
    the customer's refund request is valid or invalid under business.json rules.
    """
    api_key = (
        payload.get("grok_api_key")
        or os.environ.get("XAI_API_KEY")
        or os.environ.get("GROK_API_KEY")
        or ""
    ).strip()

    if not api_key or "YOUR_" in api_key:
        return None

    is_groq_cloud = api_key.startswith("gsk_")
    endpoint = (
        "https://api.groq.com/openai/v1/chat/completions"
        if is_groq_cloud
        else os.environ.get("GROK_API_URL", GROK_API_URL)
    )
    model = (
        payload.get("grok_model")
        or ("llama-3.3-70b-versatile" if is_groq_cloud else GROK_MODEL)
    )

    system_prompt = (
        f"You are the official AI Refund Adjudicator for {profile.get('name', 'Refund')}.\n"
        f"Tone: {profile.get('tone', 'friendly, professional, concise')}.\n"
        f"Currency: {profile.get('currency', 'R')}.\n"
        f"Business Policies:\n"
        f"- Refund Policy: {profile.get('policies', {}).get('refund', '')}\n"
        f"- Delivery Policy: {profile.get('policies', {}).get('delivery', '')}\n"
        f"- Payment Policy: {profile.get('policies', {}).get('payment', '')}\n\n"
        "ADJUDICATION RULES:\n"
        "1. If detected_flags contains 'possible_scam_or_payment_redirect' or customer asks to change bank/EFT details, "
        "the refund MUST be DECLINED (is_valid: false, decision: 'DECLINED').\n"
        "2. If the order is older than 14 days (days_since_purchase > 14), the refund MUST be DECLINED (is_valid: false, decision: 'DECLINED').\n"
        "3. If the reason is 'Changed my mind' or non-defective/opened item without valid defect, DECLINE automated refund so a manager can inspect it.\n"
        "4. If the order is within 14 days of delivery (<= 14 days), has valid Order ID proof of payment, and states a valid issue (damaged, cold, wrong item/size, late delivery), "
        "APPROVE the refund (is_valid: true, decision: 'APPROVED').\n\n"
        "Respond ONLY with a valid JSON object matching this exact schema:\n"
        "{\n"
        '  "is_valid": true or false,\n'
        '  "decision": "APPROVED" or "DECLINED",\n'
        '  "confidence": 0.92,\n'
        '  "intent": "refund" | "complaint" | "human" | "payment",\n'
        '  "needs_human": true or false,\n'
        '  "decision_reason": "Clear 1-2 sentence explanation of why Grok approved or declined the refund",\n'
        '  "reply": "Friendly, concise customer reply ending with Kind regards,\\nThe Refund Team"\n'
        "}"
    )

    user_prompt = json.dumps(
        {
            "order_code": payload.get("order_code", ""),
            "days_since_purchase": days_old,
            "selected_items": payload.get("selected_items", []),
            "refund_amount": payload.get("refund_amount", 0),
            "reason": payload.get("reason", ""),
            "customer_notes": payload.get("notes", ""),
            "detected_security_flags": detected_flags,
            "initial_intent": default_intent,
        },
        indent=2,
    )

    req_body = json.dumps(
        {
            "model": model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        endpoint,
        data=req_body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Refund-AI-Adjudicator/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            content = (
                resp_data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "{}")
            )
            parsed = json.loads(content)
            decision = str(parsed.get("decision", "DECLINED")).upper()
            if decision not in ("APPROVED", "DECLINED"):
                decision = "APPROVED" if parsed.get("is_valid") else "DECLINED"

            return {
                "is_valid": decision == "APPROVED",
                "decision": decision,
                "decision_reason": parsed.get("decision_reason")
                or parsed.get("reasoning")
                or "Evaluated by Grok AI against the 14-day refund policy.",
                "reply": parsed.get("reply", ""),
                "intent": parsed.get("intent", default_intent),
                "confidence": float(parsed.get("confidence", 0.92)),
                "needs_human": bool(parsed.get("needs_human", False))
                or len(detected_flags) > 0
                or decision == "DECLINED",
                "flags": detected_flags,
                "days_since_purchase": days_old,
                "policy_applied": profile.get("policies", {}).get("refund", ""),
                "adjudicated_by": f"Grok API ({model})",
            }
    except Exception as exc:
        print(f"[ReplyEngine] Grok API warning (falling back to rule engine): {exc}")
        return None


def adjudicate_refund(payload: dict, profile: dict) -> dict:
    """
    Evaluate a customer's refund request using the Grok API (when configured)
    plus business.json 14-day refund policy, proof of payment, and scam/escalation flags.
    """
    reason = payload.get("reason", "")
    notes = payload.get("notes", "")
    order_code = payload.get("order_code", "")
    order_created_at = payload.get("order_created_at", "")
    order_age_days = float(payload.get("order_age_days", 0))

    if order_created_at and order_age_days == 0:
        try:
            dt = datetime.fromisoformat(order_created_at.replace("Z", "+00:00"))
            delta = datetime.now(dt.tzinfo) - dt
            order_age_days = max(0.0, delta.total_seconds() / 86400.0)
        except Exception:
            pass

    days_old = int(round(order_age_days))
    refund_amount = float(payload.get("refund_amount", 0))
    combined_text = f"{reason} {notes}".strip()

    intent, confidence = classify(combined_text or payload.get("message", ""))
    detected_flags = flags(combined_text or payload.get("message", ""), profile)
    facts = facts_for(intent, profile)

    # If this is a general chat message (not a form adjudication), return standard ReplyEngine reply
    if not payload.get("adjudicate") and not reason:
        needs_human = intent in ("human", "complaint") or len(detected_flags) > 0
        return {
            "intent": intent,
            "confidence": confidence,
            "flags": detected_flags,
            "facts": facts,
            "needs_human": needs_human,
            "reply": _draft(intent, facts, detected_flags, profile),
        }

    # 1. Try Grok API first for refund validity decision
    grok_decision = call_grok_api_for_refund(
        payload, profile, days_old, detected_flags, intent
    )
    if grok_decision:
        return grok_decision

    # 2. Deterministic Policy Fallback if Grok API key is not set
    needs_human = intent in ("human", "complaint") or len(detected_flags) > 0
    has_proof_of_payment = bool(order_code)
    within_return_window = order_age_days <= 14.0

    if "possible_scam_or_payment_redirect" in detected_flags:
        decision = "DECLINED"
        reasoning = (
            "Declined automatically due to a payment-security / bank-detail change flag. "
            "Per our payment policy, we never alter banking details via chat/email and require phone verification."
        )
    elif not has_proof_of_payment:
        decision = "DECLINED"
        reasoning = (
            "Refunds require valid proof of payment (Order ID / receipt). "
            "Policy: A return is allowed when the order is yours and delivered, delivery was no more than 14 days ago, the item was not bought on sale, the quantity is not more than you bought, and there is no other open return for that item."
        )
    elif not within_return_window:
        decision = "DECLINED"
        reasoning = (
            f"Order was placed {days_old} days ago, which falls outside our 14-day refund window. "
            "Policy: A return is allowed when the order is yours and delivered, delivery was no more than 14 days ago, the item was not bought on sale, the quantity is not more than you bought, and there is no other open return for that item."
        )
    elif "changed my mind" in reason.lower():
        decision = "DECLINED"
        reasoning = (
            f"Change-of-mind refund ({profile.get('currency', 'R')}{refund_amount:.2f}) requires manager inspection of unopened/unused items. "
            "You can click 'Appeal Decision' or 'Talk to a Person' below for immediate manager review."
        )
    else:
        decision = "APPROVED"
        reasoning = (
            f"Verified proof of payment ({order_code}) and purchase date ({days_old}d old) within our 14-day policy window. "
            f"Refund of {profile.get('currency', 'R')}{refund_amount:.2f} is valid and approved for '{reason}'."
        )

    reply_text = _draft(intent, facts, detected_flags, profile)

    return {
        "is_valid": decision == "APPROVED",
        "intent": intent,
        "confidence": confidence,
        "flags": detected_flags,
        "facts": facts,
        "needs_human": needs_human or decision == "DECLINED",
        "reply": reply_text,
        "decision": decision,
        "decision_reason": reasoning,
        "reasoning": reasoning,
        "days_since_purchase": days_old,
        "policy_applied": profile.get("policies", {}).get("refund", ""),
        "adjudicated_by": "Grok Policy Fallback (Add XAI_API_KEY for live Grok LLM)",
    }


def send_or_log_escalation_email(payload: dict, profile: dict) -> dict:
    """
    Formats, logs, and optionally sends via SMTP the summarized Manager Escalation Email
    to info@example.co.za.
    """
    manager_email = profile.get("contact", {}).get("email", "info@example.co.za")
    subject = payload.get("subject", "[ESCALATION] Refund Order Escalation")
    body = payload.get("body", "")

    # Log to local file for audit trail
    log_path = Path(__file__).parent / "escalated_manager_emails.log"
    timestamp = datetime.utcnow().isoformat() + "Z"
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"\n{'=' * 72}\n")
        f.write(f"TIMESTAMP : {timestamp}\n")
        f.write(f"TO        : {manager_email}\n")
        f.write(f"SUBJECT   : {subject}\n")
        f.write(f"{'-' * 72}\n")
        f.write(f"{body}\n")
        f.write(f"{'=' * 72}\n")

    # Optional SMTP dispatch if SMTP_HOST is configured in environment
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    sent_via_smtp = False

    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = smtp_user
            msg["To"] = manager_email
            msg.set_content(body)
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)
            sent_via_smtp = True
        except Exception as exc:
            print(f"[ReplyEngine] SMTP send warning: {exc}")

    return {
        "ok": True,
        "to": manager_email,
        "subject": subject,
        "sent_via_smtp": sent_via_smtp,
        "logged_to": str(log_path.name),
        "timestamp": timestamp,
    }


class ReplyEngineHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self, status_code=200):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_cors_headers(200)

    def do_GET(self):
        profile = load_business_profile()
        self._set_cors_headers(200)
        self.wfile.write(
            json.dumps({"status": "ok", "business": profile.get("name"), "profile": profile}).encode("utf-8")
        )

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError:
            payload = {}

        profile = load_business_profile()

        if self.path in ("/escalate", "/escalate-email"):
            result = send_or_log_escalation_email(payload, profile)
            self._set_cors_headers(200)
            self.wfile.write(json.dumps(result).encode("utf-8"))
            return

        # Default: POST /reply
        result = adjudicate_refund(payload, profile)
        self._set_cors_headers(200)
        self.wfile.write(json.dumps(result).encode("utf-8"))


def run_server(port: int = 8080):
    server = HTTPServer(("0.0.0.0", port), ReplyEngineHandler)
    print(f"[ReplyEngine] Serving on http://localhost:{port} (POST /reply, POST /escalate-email)")
    server.serve_forever()


if __name__ == "__main__":
    run_server(8080)

