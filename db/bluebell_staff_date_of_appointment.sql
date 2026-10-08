-- =====================================================================
-- bluebell_staff — add DATE OF APPOINTMENT
-- Copy and paste this ENTIRE script into the Supabase SQL Editor and RUN.
-- Idempotent: the column is only added when it does not exist yet, and
-- existing rows keep a NULL appointment until it is filled in.
--
-- Where it is written:
--   Admin Dashboard -> Staff Accounts -> create / edit form
--   Staff portal    -> Profile page (self-service, allowlisted in
--                      jmischool-staff/app/api/staff-self/route.js)
-- =====================================================================

ALTER TABLE bluebell_staff ADD COLUMN IF NOT EXISTS date_of_appointment DATE;

COMMENT ON COLUMN bluebell_staff.date_of_appointment IS
  'Date the staff member was appointed / began service at the school';

-- ---------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'bluebell_staff' AND column_name = 'date_of_appointment';
