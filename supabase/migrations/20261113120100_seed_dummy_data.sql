-- Reference data and dummy data for development.
-- Dummy orders use dates relative to when this ran, so a fresh copy always
-- has orders inside and outside the 14 day return window.

-- South African public holidays. A holiday on a Sunday moves to the Monday.
-- Add new years (and any extra days the government declares) here.
insert into public.public_holidays (holiday_date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-03-21', 'Human Rights Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Family Day'),
  ('2026-04-27', 'Freedom Day'),
  ('2026-05-01', 'Workers'' Day'),
  ('2026-06-16', 'Youth Day'),
  ('2026-08-09', 'National Women''s Day'),
  ('2026-08-10', 'National Women''s Day (observed)'),
  ('2026-09-24', 'Heritage Day'),
  ('2026-12-16', 'Day of Reconciliation'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Day of Goodwill'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-03-21', 'Human Rights Day'),
  ('2027-03-22', 'Human Rights Day (observed)'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Family Day'),
  ('2027-04-27', 'Freedom Day'),
  ('2027-05-01', 'Workers'' Day'),
  ('2027-06-16', 'Youth Day'),
  ('2027-08-09', 'National Women''s Day'),
  ('2027-09-24', 'Heritage Day'),
  ('2027-12-16', 'Day of Reconciliation'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-26', 'Day of Goodwill'),
  ('2027-12-27', 'Day of Goodwill (observed)')
on conflict (holiday_date) do nothing;

-- Dummy customer service staff (not linked to a login yet; set user_id once
-- they have an account).
insert into public.employees (full_name, email, role) values
  ('Demo Agent One', 'agent.one@example.com', 'customer_service'),
  ('Demo Agent Two', 'agent.two@example.com', 'customer_service')
on conflict (email) do nothing;

-- Dummy shop orders. They link to a customer automatically when someone
-- signs up with the same email address.
with o (order_number, customer_email, status, ordered_days_ago, delivered_days_ago) as (
  values
    ('DEMO-1001', 'customer.one@example.com',   'delivered', 5,  2),
    ('DEMO-1002', 'customer.one@example.com',   'delivered', 25, 20),
    ('DEMO-1003', 'customer.two@example.com',   'delivered', 8,  6),
    ('DEMO-1004', 'customer.two@example.com',   'shipped',   2,  null),
    ('DEMO-1005', 'customer.three@example.com', 'delivered', 15, 13),
    ('DEMO-1006', 'customer.three@example.com', 'delivered', 40, 35),
    ('DEMO-1007', 'customer.four@example.com',  'delivered', 4,  1),
    ('DEMO-1008', 'customer.four@example.com',  'pending',   0,  null),
    ('DEMO-1009', 'customer.five@example.com',  'delivered', 10, 7),
    ('DEMO-1010', 'customer.five@example.com',  'cancelled', 12, null)
)
insert into public.orders (order_number, shop_name, customer_email, status, ordered_at, delivered_at)
select order_number, 'Demo Shop', customer_email, status::public.order_status,
       now() - make_interval(days => ordered_days_ago),
       case when delivered_days_ago is null then null
            else now() - make_interval(days => delivered_days_ago) end
from o
on conflict (order_number) do nothing;

with i (order_number, sku, product_name, quantity, unit_price, on_sale) as (
  values
    ('DEMO-1001', 'SKU-TSHIRT-M',  'Cotton T-shirt (M)',      2, 199.00,  false),
    ('DEMO-1001', 'SKU-JEANS-32',  'Slim jeans (32)',         1, 599.00,  true),
    ('DEMO-1002', 'SKU-JACKET-L',  'Rain jacket (L)',         1, 899.00,  false),
    ('DEMO-1002', 'SKU-CAP-01',    'Baseball cap',            1, 149.00,  false),
    ('DEMO-1003', 'SKU-SNEAK-9',   'Running sneakers (9)',    1, 1299.00, false),
    ('DEMO-1003', 'SKU-SOCKS-3P',  'Sports socks (3 pack)',   1, 129.00,  true),
    ('DEMO-1004', 'SKU-HOODIE-M',  'Hoodie (M)',              1, 549.00,  false),
    ('DEMO-1004', 'SKU-BEANIE-01', 'Beanie',                  1, 99.00,   false),
    ('DEMO-1005', 'SKU-DRESS-S',   'Summer dress (S)',        1, 699.00,  false),
    ('DEMO-1005', 'SKU-SCARF-01',  'Silk scarf',              1, 249.00,  true),
    ('DEMO-1006', 'SKU-BOOTS-7',   'Leather boots (7)',       1, 1599.00, false),
    ('DEMO-1006', 'SKU-BELT-M',    'Leather belt (M)',        1, 299.00,  false),
    ('DEMO-1007', 'SKU-SHIRT-L',   'Formal shirt (L)',        2, 449.00,  false),
    ('DEMO-1007', 'SKU-TIE-01',    'Tie',                     1, 199.00,  true),
    ('DEMO-1008', 'SKU-SHORTS-M',  'Chino shorts (M)',        1, 349.00,  false),
    ('DEMO-1008', 'SKU-SANDAL-8',  'Sandals (8)',             1, 399.00,  false),
    ('DEMO-1009', 'SKU-BAG-01',    'Backpack',                1, 799.00,  false),
    ('DEMO-1009', 'SKU-BOTTLE-01', 'Water bottle',            2, 149.00,  true),
    ('DEMO-1010', 'SKU-WATCH-01',  'Digital watch',           1, 999.00,  false),
    ('DEMO-1010', 'SKU-STRAP-01',  'Watch strap',             1, 129.00,  false)
)
insert into public.order_items (order_id, sku, product_name, quantity, unit_price, on_sale)
select ord.id, i.sku, i.product_name, i.quantity, i.unit_price, i.on_sale
from i
join public.orders ord on ord.order_number = i.order_number
where not exists (
  select 1 from public.order_items x where x.order_id = ord.id and x.sku = i.sku
);

update public.orders ord
   set total_amount = t.total
  from (
    select order_id, sum(quantity * unit_price) as total
    from public.order_items group by order_id
  ) t
 where t.order_id = ord.id
   and ord.order_number like 'DEMO-%';
