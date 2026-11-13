// Plain message text for a return notification. No secrets and no network.

const STATUS_LABELS = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Not accepted",
  in_transit: "On its way back to us",
  received: "Received by the store",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export function statusLabel(status) {
  if (!status) return "";
  return STATUS_LABELS[status] || String(status).replace(/_/g, " ");
}

const CUSTOMER_SUBJECTS = {
  submitted: "We received your return request",
  approved: "Your return is approved",
  rejected: "Update on your return request",
  in_transit: "Your return is on its way",
  received: "We received your returned item",
  refunded: "Your refund is on its way",
  cancelled: "Your return was cancelled",
};

const OWNER_SUBJECTS = {
  submitted: "New return request",
  approved: "Return approved",
  rejected: "Return rejected",
  in_transit: "Return on its way back",
  received: "Returned item received",
  refunded: "Return refunded",
  cancelled: "Return cancelled",
};

export function customerSubject(status) {
  return CUSTOMER_SUBJECTS[status] || "Update on your return";
}

export function ownerSubject(status, order) {
  const base = OWNER_SUBJECTS[status] || `Return update: ${statusLabel(status)}`;
  return order ? `${base} — ${order}` : base;
}

export function nextSteps(status) {
  switch (status) {
    case "submitted":
      return "We received your return and it is awaiting review. You do not need to send the parcel yet.";
    case "approved":
      return "Your return was approved. We will arrange collection. Watch your email for the waybill.";
    case "rejected":
      return "Your return was not accepted. Reply to us if you want a person to look at it again.";
    case "in_transit":
      return "The parcel is on its way back to us.";
    case "received":
      return "We have the parcel. The refund is still being processed.";
    case "refunded":
      return "The refund has been issued back to the original payment method.";
    case "cancelled":
      return "This return was cancelled. No further action is needed.";
    default:
      return "We will email you again when the status changes.";
  }
}

export function customerEmail(note, brand) {
  const name = note.customer_name ? ` ${note.customer_name}` : "";
  const item = note.product_name || "Item";
  const qty = note.quantity ?? 1;
  const text = [
    `Hi${name},`,
    "",
    `Status: ${statusLabel(note.new_status)}`,
    `Order: ${note.order_number || ""}`,
    `Item: ${qty} x ${item}`,
    note.reason ? `Reason: ${note.reason}` : null,
    `Reference: ${note.return_id}`,
    "",
    nextSteps(note.new_status),
    "",
    brand,
  ].filter((line) => line !== null).join("\n");
  return {
    to: note.customer_email,
    subject: note.order_number
      ? `${customerSubject(note.new_status)} (order ${note.order_number})`
      : customerSubject(note.new_status),
    text,
  };
}

export function ownerEmail(note, brand) {
  const text = [
    `${statusLabel(note.new_status)}: return for ${note.customer_email}.`,
    `Order: ${note.order_number || ""}`,
    `Item: ${note.quantity ?? 1} x ${note.product_name || "Item"}`,
    note.reason ? `Reason: ${note.reason}` : null,
    `Reference: ${note.return_id}`,
    note.old_status ? `Previous status: ${statusLabel(note.old_status)}` : "This is a new return.",
    "",
    brand,
  ].filter((line) => line !== null).join("\n");
  return {
    subject: ownerSubject(note.new_status, note.order_number || note.return_id),
    text,
  };
}

export function slackText(note) {
  return [
    `*${ownerSubject(note.new_status, note.order_number)}*`,
    `*Customer:* ${note.customer_name || ""} <${note.customer_email}>`,
    `*Order:* ${note.order_number || ""}`,
    `*Item:* ${note.quantity ?? 1} x ${note.product_name || "Item"}`,
    note.reason ? `*Reason:* ${note.reason}` : null,
    `*Reference:* \`${note.return_id}\``,
  ].filter(Boolean).join("\n");
}
