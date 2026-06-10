-- The "Client email (Gmail)" connector stores rows in user_integrations with
-- provider='gmail_smtp', but the provider column is the integration_provider
-- ENUM which only knew calendly / google_meet / zoom. Add the new value.

alter type integration_provider add value if not exists 'gmail_smtp';
