/**
 * The privacy notice's data inventory. tests/anonymity.test.ts compares this against the LIVE database schema
 * (information_schema) in CI: a column added to a tipster-facing table without being listed here - or listed
 * here but missing - fails the build, so the notice cannot silently drift from what is really stored.
 */
export const TIPSTER_DATA: Record<string, Record<string, string>> = {
  tips: {
    id: 'a random internal record number',
    org_id: 'which organization receives the tip',
    tip_id: 'your random TIP ID',
    passcode_hash: 'a one-way scrambled (argon2) form of your passcode - we cannot read or recover your passcode',
    location_id: 'the location you picked, if any',
    category_id: 'the category you picked',
    urgent: 'whether you marked the tip urgent',
    description: 'the description you typed',
    status: 'the review status (New, Under Review, Actioned, Closed)',
    needs_reply: 'whether a reviewer still owes you a reply',
    assigned_reviewer_id: 'which staff member is handling it',
    closure_reason: 'why staff closed it',
    closure_note: 'an optional staff note when closing',
    closed_at: 'when it was closed',
    first_response_at: 'when staff first replied (used for response-time statistics)',
    reward_eligible: 'whether staff marked the tip reward-eligible',
    reward_amount_cents: 'the reward amount staff set',
    claim_code_hash: 'a one-way scrambled form of your reward claim code',
    claim_code_revealed_at: 'when the claim code was shown to you',
    claimed_at: 'when staff recorded the reward as claimed',
    failed_attempts: 'a counter of wrong passcode tries (protects your tip from guessing)',
    locked_until: 'a temporary lock time after too many wrong tries',
    claim_failed_attempts: 'a counter of wrong claim-code tries',
    claim_locked_until: 'a temporary lock time after too many wrong claim-code tries',
    created_at: 'when the tip was submitted',
    updated_at: 'when the tip last changed (used to decide when it is deleted)',
    source: 'whether you used the website or a staff member typed in your call or visit',
    watch_hits: "which words from the organization's own watch list appear in your text (so staff can notice serious reports quickly)",
    waiting_since: 'when a staff reply became due (used to measure response times)',
    bulletin_id: 'the public case bulletin you chose to tip about, if any',
  },
  messages: {
    id: 'a random message id',
    seq: 'message order number',
    org_id: 'which organization the message belongs to',
    tip_id: 'which tip the message belongs to',
    sender: 'whether you or a reviewer wrote it',
    reviewer_id: 'which staff member wrote a reviewer message (never shown to you)',
    body: 'the message text',
    created_at: 'when it was sent',
  },
  media: {
    id: 'a random file id',
    org_id: 'which organization the file belongs to',
    tip_id: 'which tip the file belongs to',
    kind: 'photo, video, audio or document',
    mime: 'the detected file type',
    size_bytes: 'the file size',
    storage_key: 'a random storage path (never your original file name)',
    created_at: 'when the file was stored',
  },
  push_subscriptions: {
    id: 'a random id',
    org_id: 'which organization',
    tip_id: 'which tip to notify',
    subscription: 'the anonymous browser push address, only if you opted in to notifications',
  },
};

/** Column names that would identify a person or device. No tipster-facing table may ever contain one. */
export const IDENTIFYING_COLUMN = /(^|_)(ip|ip_address|ua|user_agent|useragent|device|fingerprint|email|phone|mobile|name|filename|file_name|original|lat|lng|latitude|longitude|geo|address|session|cookie|referrer|referer)(_|$)/i;
