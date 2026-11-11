-- Add is_late flag to activity_logs for late note submissions
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS is_late boolean DEFAULT false;
