-- =============================================================================
-- Tasks – Phase 1 schema
-- Run this once in the Supabase SQL editor (it's idempotent — safe to re-run).
--
-- What it creates:
--   • Enums: task_status, task_priority, custom_field_type, custom_field_role.
--   • Tables: task_folders, tasks, task_assignees, task_checklists,
--             task_checklist_items, task_custom_fields, task_messages,
--             task_status_log, task_templates.
--   • Updated-at triggers for folders + tasks.
--   • Two SQL helper functions used by RLS:
--       is_admin_or_manager()
--       can_access_client(client_uuid uuid)
--   • RLS policies on every new table:
--       admin/manager → full access.
--       everyone else → only rows for clients they're in client_assignees for.
-- =============================================================================

-- 1. ENUMS ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM (
    'new',
    'in_progress',
    'waiting_for_footage',
    'discontinued',
    'ready_for_review',
    'ready_for_approval',
    'approved',
    'complete'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE custom_field_type AS ENUM ('text', 'url', 'file', 'folder');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE custom_field_role AS ENUM (
    'main_deliverable',
    'captions',
    'thumbnail',
    'cover',
    'generic'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. PREFLIGHT -----------------------------------------------------------------
-- If a stale 'tasks' table exists (e.g. from an earlier prototype) without the
-- columns we need, blow it (and anything that depended on it) away so the
-- CREATE TABLE IF NOT EXISTS below actually creates the new schema.
DO $$
DECLARE
  has_tasks         boolean;
  has_folder_id     boolean;
  has_client_id     boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tasks'
  ) INTO has_tasks;

  IF has_tasks THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'folder_id'
    ) INTO has_folder_id;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'client_id'
    ) INTO has_client_id;

    IF NOT has_folder_id OR NOT has_client_id THEN
      RAISE NOTICE 'Stale tasks schema detected — dropping legacy tasks tables';
      DROP TABLE IF EXISTS public.task_assignees       CASCADE;
      DROP TABLE IF EXISTS public.task_checklists      CASCADE;
      DROP TABLE IF EXISTS public.task_checklist_items CASCADE;
      DROP TABLE IF EXISTS public.task_custom_fields   CASCADE;
      DROP TABLE IF EXISTS public.task_messages        CASCADE;
      DROP TABLE IF EXISTS public.task_status_log      CASCADE;
      DROP TABLE IF EXISTS public.task_folders         CASCADE;
      DROP TABLE IF EXISTS public.tasks                CASCADE;
    END IF;
  END IF;
END $$;

-- 3. TABLES --------------------------------------------------------------------

-- Folders are nestable: parent_folder_id NULL = top-level for that client.
CREATE TABLE IF NOT EXISTS task_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  parent_folder_id uuid REFERENCES task_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_folders_client_id_idx
  ON task_folders(client_id);
CREATE INDEX IF NOT EXISTS task_folders_parent_idx
  ON task_folders(parent_folder_id);

-- A task always belongs to a client. folder_id is optional (a task at the
-- root of a client). parent_task_id allows nesting subtasks.
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES task_folders(id) ON DELETE SET NULL,
  parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status task_status NOT NULL DEFAULT 'new',
  priority task_priority NOT NULL DEFAULT 'medium',
  start_at timestamptz,
  due_at timestamptz,
  position int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_client_id_idx       ON tasks(client_id);
CREATE INDEX IF NOT EXISTS tasks_folder_id_idx       ON tasks(folder_id);
CREATE INDEX IF NOT EXISTS tasks_parent_task_id_idx  ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx          ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_due_at_idx          ON tasks(due_at);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS task_assignees_user_id_idx
  ON task_assignees(user_id);

CREATE TABLE IF NOT EXISTS task_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Checklist',
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_checklists_task_id_idx
  ON task_checklists(task_id);

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES task_checklists(id) ON DELETE CASCADE,
  label text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  position int NOT NULL DEFAULT 0,
  done_at timestamptz,
  done_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS task_checklist_items_checklist_id_idx
  ON task_checklist_items(checklist_id);

-- Custom fields. parent_field_id pairs a captions/thumbnail/cover field with
-- its main_deliverable so the approval pipeline can group them later.
CREATE TABLE IF NOT EXISTS task_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL,
  type custom_field_type NOT NULL,
  role custom_field_role NOT NULL DEFAULT 'generic',
  value text,
  parent_field_id uuid REFERENCES task_custom_fields(id) ON DELETE SET NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_custom_fields_task_id_idx
  ON task_custom_fields(task_id);
CREATE INDEX IF NOT EXISTS task_custom_fields_parent_field_id_idx
  ON task_custom_fields(parent_field_id);

CREATE TABLE IF NOT EXISTS task_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_messages_task_id_created_idx
  ON task_messages(task_id, created_at DESC);

-- Status audit trail. The API layer writes a row every time it updates a
-- task's status, so we always know who changed it and when.
CREATE TABLE IF NOT EXISTS task_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status task_status,
  to_status task_status NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_status_log_task_id_idx
  ON task_status_log(task_id, changed_at DESC);

-- Templates store a snapshot of a task tree (task + subtasks + checklists +
-- custom fields) as JSON, so we can clone it back into any client folder.
CREATE TABLE IF NOT EXISTS task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. UPDATED-AT TRIGGERS -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_folders_updated_at ON task_folders;
CREATE TRIGGER task_folders_updated_at
  BEFORE UPDATE ON task_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS HELPERS ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.can_access_client(client_uuid uuid)
RETURNS boolean AS $$
  SELECT
    public.is_admin_or_manager()
    OR EXISTS (
      SELECT 1
      FROM public.client_assignees
      WHERE user_id = auth.uid()
        AND client_id = client_uuid
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 6. RLS POLICIES --------------------------------------------------------------

-- Helper: drop all existing policies for a table so this script stays
-- idempotent without naming each policy explicitly.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'task_folders', 'tasks', 'task_assignees', 'task_checklists',
        'task_checklist_items', 'task_custom_fields', 'task_messages',
        'task_status_log', 'task_templates'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE task_folders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_custom_fields   ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_status_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_templates       ENABLE ROW LEVEL SECURITY;

-- Folders: gated by client.
CREATE POLICY task_folders_all ON task_folders
  FOR ALL
  USING (public.can_access_client(client_id))
  WITH CHECK (public.can_access_client(client_id));

-- Tasks: gated by client.
CREATE POLICY tasks_all ON tasks
  FOR ALL
  USING (public.can_access_client(client_id))
  WITH CHECK (public.can_access_client(client_id));

-- Assignees: gated by parent task's client.
CREATE POLICY task_assignees_all ON task_assignees
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND public.can_access_client(t.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND public.can_access_client(t.client_id)
    )
  );

-- Checklists: gated by parent task's client.
CREATE POLICY task_checklists_all ON task_checklists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_checklists.task_id
        AND public.can_access_client(t.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_checklists.task_id
        AND public.can_access_client(t.client_id)
    )
  );

-- Checklist items: gated by parent task's client (via checklist).
CREATE POLICY task_checklist_items_all ON task_checklist_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM task_checklists c
      JOIN tasks t ON t.id = c.task_id
      WHERE c.id = task_checklist_items.checklist_id
        AND public.can_access_client(t.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM task_checklists c
      JOIN tasks t ON t.id = c.task_id
      WHERE c.id = task_checklist_items.checklist_id
        AND public.can_access_client(t.client_id)
    )
  );

-- Custom fields.
CREATE POLICY task_custom_fields_all ON task_custom_fields
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_custom_fields.task_id
        AND public.can_access_client(t.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_custom_fields.task_id
        AND public.can_access_client(t.client_id)
    )
  );

-- Messages: anyone with task access can read + post. (No "private DM" tier.)
CREATE POLICY task_messages_all ON task_messages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_messages.task_id
        AND public.can_access_client(t.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_messages.task_id
        AND public.can_access_client(t.client_id)
    )
  );

-- Status log: read-only from the client; the API writes to it via the service
-- key. We still gate reads so employees can only see history for tasks they
-- can see.
CREATE POLICY task_status_log_select ON task_status_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_status_log.task_id
        AND public.can_access_client(t.client_id)
    )
  );

-- Templates: shared templates visible to all authenticated agency users;
-- private templates only visible to their owner. Admin/manager can manage all.
CREATE POLICY task_templates_select ON task_templates
  FOR SELECT
  USING (
    is_shared = true
    OR owner_id = auth.uid()
    OR public.is_admin_or_manager()
  );

CREATE POLICY task_templates_insert ON task_templates
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY task_templates_update ON task_templates
  FOR UPDATE
  USING (owner_id = auth.uid() OR public.is_admin_or_manager())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin_or_manager());

CREATE POLICY task_templates_delete ON task_templates
  FOR DELETE
  USING (owner_id = auth.uid() OR public.is_admin_or_manager());

-- =============================================================================
-- Done.  Next: the API + UI lives in /src and writes through the service-role
-- key on server routes, bypassing RLS where needed (e.g. to insert into
-- task_status_log on behalf of a user we've already authenticated).
-- =============================================================================
