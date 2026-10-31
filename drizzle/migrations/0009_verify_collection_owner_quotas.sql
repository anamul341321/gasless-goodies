-- Run with the migration tool's privileged connection; no wallet data is written.
DO $$
BEGIN
 IF public.gd_collection_owner_slots(0,2) <> 200 THEN
  RAISE EXCEPTION 'A new owner must retain capacity alongside another owner';
 END IF;
 IF public.gd_collection_owner_slots(200,2) <> 0 THEN
  RAISE EXCEPTION 'A busy owner must not take another owners capacity';
 END IF;
 IF public.gd_collection_owner_slots(0,10) <> 100 THEN
  RAISE EXCEPTION 'Ten owners must share the safety ceiling fairly';
 END IF;
 IF public.gd_collection_owner_slots(100,10) <> 0 THEN
  RAISE EXCEPTION 'Owners at their fair quota cannot reserve more';
 END IF;
END $$;