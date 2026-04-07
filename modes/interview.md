# Mode: interview — Interview Intelligence Briefing

When the user says "prep me for [company] interview" or "I have an interview at [company]":

## Step 0 — Locate the Report

1. Search `data/applications.md` for the company name
2. Find the associated report in `reports/`
3. Read the full report — this is your primary source of truth for this company
4. Read `cv.md` and `interview-prep/story-bank.md`

If no report exists, create a light brief using WebSearch only.

## Step 1 — Company Brief (2-minute read)

```markdown
## Company Quick Brief

**What they do:** [1 sentence]
**Founded:** [year] | **Stage:** [public/Series X/bootstrapped]
**Team size:** [approx]
**Key product/platform:** [1-2 sentences on what matters to you as an engineer]
**Recent news:** [1-2 relevant items from last 6 months]
**Tech stack:** [languages, frameworks, infra inferred from JD]
**Engineering culture signals:** [from JD, Glassdoor, LinkedIn]
```

Use WebSearch to fill gaps. Focus on what matters for interview context, not investor pitch.

## Step 2 — Interviewer Research Prompts

If the user mentions specific interviewer names, generate:
- LinkedIn search queries to find their background
- Key talking points based on their apparent work (publications, GitHub, talks)
- Questions to ask them specifically

If no names yet, provide:
> "Before the interview, find your interviewers on LinkedIn. For each one: note their tenure, what they've built, and one question that shows you've done your homework."

## Step 3 — Top 10 Technical Questions

Based on the JD and role archetype, generate the 10 most likely technical interview questions. For each:
- The question
- Why they're asking it (what signal they're looking for)
- Your recommended answer structure (STAR or technical walkthrough)

Adapt to archetype:
- **LLM/GenAI:** RAG design, prompt engineering, fine-tuning decisions, evaluation strategies
- **MLOps/LLMOps:** pipeline design, observability, model versioning, CI/CD for ML
- **Agentic:** agent orchestration, tool use, HITL design, failure modes
- **AI Backend/Infra:** system design, low-latency serving, GPU utilization, scalability
- **ML Engineer:** training loops, hyperparameter tuning, model evaluation, production deployment
- **Research Engineer:** paper discussions, experiment design, benchmark methodology

## Step 4 — Top 5 Behavioral Questions

Standard behavioral questions likely for this company's culture:
1. "Tell me about a time you had to make a decision with incomplete information"
2. "Describe a project you're most proud of and why"
3. [3 more company/culture-specific behavioral questions]

For each: the underlying competency they're assessing + signal they want to see.

## Step 5 — STAR Story Mapping

Read `interview-prep/story-bank.md`. Select 3 stories that best map to:
1. The primary technical archetype of this role
2. The company's apparent culture/values
3. The seniority level they're hiring for

For each recommended story:
```
Story: [story title from bank]
Maps to: [which behavioral question or archetype signal]
Adaptation: [how to frame it specifically for this company/role]
```

If story-bank.md is sparse, suggest which experiences from cv.md to turn into STAR stories.

## Step 6 — Questions to Ask the Interviewer

Generate 5 questions — one for each category:
1. **Technical direction:** "What's the biggest technical challenge the team is working on this quarter?"
2. **Success metrics:** "What would make someone exceptional in this role in the first 6 months?"
3. **Team culture:** "How does the team handle disagreements on technical direction?"
4. **Growth:** "What's the learning/growth path for someone in this role?"
5. **Strategic:** [one company-specific strategic question based on recent news or JD]

## Step 7 — Save Briefing

Write the complete briefing to `interview-prep/{num}-{company-slug}-prep.md`.
Format as clean markdown — this should be printable and reviewable in 5 minutes before the interview.

## Rules

- **Be specific.** Generic interview prep is useless. Every question should reference the actual JD or company.
- **Prioritize the report.** Your evaluation already identified the key fit and gaps — mirror that in the prep.
- **Flag the hard questions.** If there are gaps in the CV that the interviewer will likely probe, call them out with a mitigation script.
- **3 stories minimum.** More is better, but 3 covering the key competencies is the floor.
- **Never prep for questions that aren't going to be asked.** Focus on what this archetype at this company actually interviews for.
