# Mode: outreach — Cold Outreach Generator

When the user asks to reach out to someone at [company] or requests a connection message:

## Step 0 — Gather Context

Required inputs:
- **Company name** (required)
- **Target role** at that company (required)
- **LinkedIn profile URL** or person's name/title (optional but improves quality)
- **Mutual connection** or shared context (optional)

If no person is specified, default to targeting the hiring manager or relevant engineering lead.

## Step 1 — Research (if LinkedIn URL provided)

Use Playwright or WebSearch to extract:
- Their current role and tenure
- Their career background (previous companies, roles)
- Any public work: GitHub, papers, talks, blog posts
- Mutual connections or shared background

Use this to make the message genuinely specific, not generic.

## Step 2 — LinkedIn Message (< 300 chars)

**Connection request note** — must be under 300 characters for LinkedIn limit.

Format:
```
[Specific hook about them or shared context] — [Your 1-line relevant background] — [Specific ask or reason to connect]. [Name]
```

Example structure (not template — make it specific):
> "Saw your talk on [topic] at [event] — [1 genuine reaction]. I'm a [your role] with [relevant experience]. Wanted to connect and explore [specific opportunity]. — [Name]"

Rules for the LinkedIn note:
- **No "I saw you're hiring"** — too transactional
- **No "I'm a big fan"** — too generic
- **One specific thing about them** — show you actually looked
- **Count the characters.** LinkedIn cuts off at 300. Check length.

## Step 3 — Full Outreach Message (email or LinkedIn DM)

4 sentences maximum. No exceptions.

**Sentence 1 — Hook (specific to them)**
Reference something real: their work, their company, a talk, a post, a problem they're solving. This is what separates a human message from a template.

**Sentence 2 — Your relevant background (compressed)**
The one sentence that explains why you're worth their attention. Lead with your most relevant credential or achievement for this specific context.

**Sentence 3 — Specific ask**
Be direct. "I'd love to learn more about the [Role] you're building toward" or "I'm exploring opportunities in [space] and your team's work on [X] is directly relevant."

**Sentence 4 — CTA (low-friction)**
Easy yes: "Would a 15-minute call this week work?" or "Happy to share more — do you want me to send my CV?"

**Tone:** Professional but human. Write like a person, not a PR department. Short sentences.

## Step 4 — Follow-up Message (if no response in 7 days)

1-2 sentences only. Reference the original message briefly, add one new piece of value (a relevant article, a project update, a question), and gently re-extend the ask.

Example:
> "Following up on my note from [X] — saw [Company] just [news item]. Still very interested in connecting. Is this a better time?"

## Step 5 — Log to Outreach Tracker

Append to `data/outreach-log.md`:

```markdown
## [Company] — [Person Name/Role] — [Date]

**Channel:** LinkedIn / Email
**Status:** Sent / Pending / Responded / Meeting Scheduled

**Message sent:**
[message text]

**Response:**
[if any]
```

If `data/outreach-log.md` doesn't exist, create it with a header:
```markdown
# Outreach Log

| Date | Company | Person | Channel | Status | Notes |
|------|---------|--------|---------|--------|-------|
```

## Rules

- **Never send a generic template.** Every message must have at least one specific detail about the recipient.
- **Never claim to be something you're not.** If you're open to relocation, say so. If not, don't imply it.
- **Never ask for a job in the first message.** Ask for a conversation, not a position.
- **Always read `cv.md` before writing.** The message should reflect actual experience, not invented credentials.
- **Count LinkedIn note characters.** 300 character limit is hard. Check before presenting.
- **Update the outreach log.** Every sent message should be tracked for follow-up.
- **One ask per message.** Don't ask for both a call and a referral in the same message.
