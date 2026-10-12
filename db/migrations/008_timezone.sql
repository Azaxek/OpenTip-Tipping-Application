-- The program's own time zone (an IANA name such as America/Chicago). Analytics day boundaries and "today" follow it, so a tip
-- received at 9 pm Central is counted on that day, not on tomorrow's UTC date. Existing programs start at UTC and can change it in Settings.
alter table organizations add column timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64);
