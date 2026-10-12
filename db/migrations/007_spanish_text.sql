-- Optional Spanish versions of the two texts an organization writes for tipsters. Blank = use the built-in Spanish default
-- while the English text is still the default, otherwise the English text. Organization settings, not tipster data.
alter table organizations
  add column tipster_note_es text not null default '' check (char_length(tipster_note_es) <= 600),
  add column help_text_es text not null default '' check (char_length(help_text_es) <= 1200);
