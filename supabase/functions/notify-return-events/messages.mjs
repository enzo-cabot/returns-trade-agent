// Plain message text for a return notification. No secrets and no network.

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
    `Your return is now ${note.new_status}.`,
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
    subject: `Return ${note.new_status} — order ${note.order_number || ""}`.trim(),
    text,
  };
}

export function ownerEmail(note, brand) {
  const text = [
    `Return ${note.new_status} for ${note.customer_email}.`,
    `Order: ${note.order_number || ""}`,
    `Item: ${note.quantity ?? 1} x ${note.product_name || "Item"}`,
    note.reason ? `Reason: ${note.reason}` : null,
    `Reference: ${note.return_id}`,
    note.old_status ? `Previous status: ${note.old_status}` : "This is a new return.",
    "",
    brand,
  ].filter((line) => line !== null).join("\n");
  return {
    subject: `Return ${note.new_status} — ${note.order_number || note.return_id}`,
    text,
  };
}

export function slackText(note) {
  return [
    `*Return ${note.new_status}*`,
    `*Customer:* ${note.customer_name || ""} <${note.customer_email}>`,
    `*Order:* ${note.order_number || ""}`,
    `*Item:* ${note.quantity ?? 1} x ${note.product_name || "Item"}`,
    note.reason ? `*Reason:* ${note.reason}` : null,
    `*Reference:* \`${note.return_id}\``,
  ].filter(Boolean).join("\n");
}
