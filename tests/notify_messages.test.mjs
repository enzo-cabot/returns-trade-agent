import assert from "node:assert/strict";
import test from "node:test";
import {
  customerEmail,
  customerSubject,
  nextSteps,
  ownerEmail,
  ownerSubject,
  slackText,
  statusLabel,
} from "../supabase/functions/notify-return-events/messages.mjs";

const note = {
  return_id: "ret-1",
  new_status: "submitted",
  old_status: null,
  customer_email: "buyer@example.com",
  customer_name: "Buyer",
  order_number: "DEMO-1001",
  product_name: "Cotton T-shirt",
  quantity: 2,
  reason: "Wrong size",
};

test("customer email names the order, item, status, and next step", () => {
  const mail = customerEmail(note, "Returns Trade Agent");
  assert.equal(mail.to, "buyer@example.com");
  assert.equal(mail.subject, "We received your return request (order DEMO-1001)");
  assert.equal(statusLabel("submitted"), "Submitted");
  assert.equal(customerSubject("submitted"), "We received your return request");
  assert.match(mail.text, /Status: Submitted/);
  assert.match(mail.text, /2 x Cotton T-shirt/);
  assert.match(mail.text, /Wrong size/);
  assert.match(mail.text, /awaiting review/);
  assert.match(mail.text, /Returns Trade Agent/);
});

test("approved mail does not say the customer already has a refund", () => {
  const mail = customerEmail({ ...note, new_status: "approved", old_status: "submitted" }, "Returns Trade Agent");
  assert.match(mail.text, /approved/i);
  assert.match(mail.text, /collection/);
  assert.doesNotMatch(mail.text, /refund has been issued/);
});

test("owner email and slack include the customer and the order", () => {
  const owner = ownerEmail(note, "Returns Trade Agent");
  assert.equal(owner.subject, ownerSubject("submitted", "DEMO-1001"));
  assert.match(owner.text, /buyer@example.com/);
  assert.match(owner.text, /DEMO-1001/);
  const slack = slackText(note);
  assert.match(slack, /DEMO-1001/);
  assert.match(slack, /buyer@example.com/);
});

test("every status has a next step", () => {
  for (const status of ["submitted", "approved", "rejected", "in_transit", "received", "refunded", "cancelled"]) {
    assert.ok(nextSteps(status).length > 10, status);
  }
});
