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

const cancellation = {
  id: "note-1",
  kind: "order_cancellation",
  cancellation_id: "can-1",
  return_id: null,
  new_status: "cancelled",
  old_status: null,
  customer_email: "buyer@example.com",
  customer_name: "Buyer",
  order_number: "TEST-6652",
  product_name: "Coach Jacket",
  quantity: 1,
  amount: "890.00",
  reason: "Order took too long",
};

test("order cancellation emails say the item will not ship and show the amount", () => {
  const mail = customerEmail(cancellation, "Returns Trade Agent");
  assert.equal(mail.to, "buyer@example.com");
  assert.equal(mail.subject, "Your item was cancelled (order TEST-6652)");
  assert.match(mail.text, /Cancelled before shipping/);
  assert.match(mail.text, /1 x Coach Jacket/);
  assert.match(mail.text, /R890\.00/);
  assert.match(mail.text, /can-1/);
  assert.doesNotMatch(mail.text, /null/);
  const owner = ownerEmail(cancellation, "Returns Trade Agent");
  assert.equal(owner.subject, "Item cancelled before shipping — TEST-6652");
  assert.match(owner.text, /Do not pack or ship/);
  const slack = slackText(cancellation);
  assert.match(slack, /TEST-6652/);
  assert.match(slack, /R890\.00/);
});

test("rows without a kind are still treated as returns", () => {
  const mail = customerEmail({ ...note, kind: undefined }, "Returns Trade Agent");
  assert.match(mail.subject, /return request/);
});
