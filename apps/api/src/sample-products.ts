type SampleProduct = {
  slug: string;
  name: string;
  description: string;
  priceMinor: number;
  instructions: string;
  files: Record<string, string>;
};
export type SampleMerchant = { id: string; name: string; products: SampleProduct[] };

const websiteStyles = `
:root { color-scheme: light; --ink:#193a31; --paper:#f8f9f2; --accent:#d8eca4; }
* { box-sizing:border-box; }
body { margin:0; font:17px/1.65 system-ui,sans-serif; background:var(--paper); color:var(--ink); }
a { color:inherit; text-underline-offset:4px; }
a:focus-visible { outline:3px solid #486b32; outline-offset:5px; }
header,main,footer { width:min(100% - 40px,1080px); margin:auto; }
header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:20px; padding:28px 0; }
nav { display:flex; gap:24px; }
.hero { padding:72px 0; max-width:750px; }
h1 { font-size:clamp(36px,7vw,76px); letter-spacing:-.05em; line-height:1.08; margin:20px 0; }
h2 { font-size:30px; line-height:1.2; }
.eyebrow { font-size:13px; text-transform:uppercase; letter-spacing:.12em; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr)); gap:22px; }
article { background:white; border:1px solid #dde5d2; border-radius:20px; padding:28px; }
article.featured { background:var(--accent); }
.price { font-size:40px; margin:16px 0; }
.button { display:inline-block; border-radius:9px; padding:12px 20px; background:var(--ink); color:white; text-decoration:none; }
section { scroll-margin-top:25px; }
footer { padding:54px 0 24px; font-size:14px; }
@media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto; } }
`;

function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Editable Antspace sandbox sample template."><title>${title}</title><link rel="stylesheet" href="styles.css"></head>
<body>${body}<footer>Original Antspace sandbox sample. Replace placeholder names, offers, and contact details before publishing.</footer></body></html>`;
}

function socialLayout(title: string, subtitle: string, background: string, foreground: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label="Editable social post layout">
<rect width="1080" height="1080" fill="${background}"/>
<circle cx="960" cy="160" r="280" fill="${foreground}" opacity=".08"/>
<path d="M80 80h120M80 80v120M1000 1000H880M1000 1000V880" fill="none" stroke="${foreground}" stroke-width="4"/>
<g fill="${foreground}" font-family="Arial,sans-serif"><text x="100" y="310" font-size="24" letter-spacing="5">YOUR STUDIO / EDITABLE SAMPLE</text>
<text x="100" y="510" font-size="72" font-weight="700">${title}</text><text x="100" y="600" font-size="32">${subtitle}</text>
<text x="100" y="890" font-size="23">Replace this line with your next step.</text></g></svg>`;
}

export function sampleMerchants(bootstrapMerchantId: string): SampleMerchant[] {
  return [
    { id: bootstrapMerchantId, name: "Atlas Digital Market", products: [
      {
        slug: "customer_interview_workbook", name: "Customer Interview Workbook", priceMinor: 1900,
        description: "A beginner-friendly customer research workbook with an interview script, evidence tracker, and synthesis guide.",
        instructions: "Read interview-guide.md, run five interviews, and enter anonymized notes in evidence-tracker.csv. Open the CSV in any spreadsheet app.",
        files: {
          "interview-guide.md": `# Customer interview workbook
## Choose a question
Write one assumption you want to test: Who experiences the problem, when, and how often?
Example: Independent illustrators lose time organizing client feedback.
## Invite five relevant people
Explain your purpose, ask permission to take notes, and offer to anonymize responses.
Do not collect payment details, passwords, or unnecessary personal information.
## 20-minute interview
1. Tell me about the last time you encountered this problem.
2. What triggered it? Walk me through what happened next.
3. What tools or workarounds did you use?
4. What was frustrating, slow, or expensive?
5. What did you try before this approach?
6. How did you decide which solution to use?
7. What outcome would have made that experience better?
## Record evidence
Capture observations separately from your interpretation. Avoid pitching during the interview.
## Synthesize
Group recurring problems. Note contradictions and the number of people who raised each issue.
Choose one small experiment and define what evidence would make you abandon the idea.
## Decision template
Assumption:
Supporting observations:
Contradictory observations:
Confidence (low/medium/high):
Next experiment:
Review date:`,
          "evidence-tracker.csv": `Participant,Context,Observed problem,Current workaround,Impact,Evidence,Next question
P01,Client feedback,Comments arrive in several channels,Manual checklist,Repeated work,Illustrative example only,How often does this happen?
P02,,,,,,
P03,,,,,,
P04,,,,,,
P05,,,,,,`,
        },
      },
      {
        slug: "freelancer_proposal_kit", name: "Freelancer Proposal Kit", priceMinor: 2900,
        description: "Editable proposal, project scope, and handover templates for freelancers selling creative or technical work.",
        instructions: "Copy proposal.md for each project and replace bracketed text. Use scope-checklist.csv before agreeing on delivery. These are project planning samples, not legal contracts.",
        files: {
          "proposal.md": `# Proposal: [Project name]
Prepared for: [Client]
Prepared by: [Your business]
Date and version: [Date / v1]
## Context
[Describe the client's current situation in two sentences.]
## Desired outcome
[Name one measurable change and how the client will assess it.]
## Deliverables
1. [Deliverable, format, and quantity]
2. [Deliverable, format, and quantity]
3. [Handover and documentation]
## Approach
Discovery -> first draft -> review -> revision -> handover.
## Timeline
Kickoff: [Date]. First review: [Date]. Final delivery: [Date].
## Project estimate
[List line items, quantities, assumptions, and payment milestones separately.]
## Scope boundaries
[What is included, excluded, and handled as an additional request?]
## Client inputs
[Assets, access, feedback owner, and feedback deadlines.]
## Next step
[Arrange a scope review and resolve open questions before starting.]
This is a sample proposal outline, not a legal agreement.`,
          "scope-checklist.csv": `Check,Owner,Status,Notes
Outcome agreed,Both,Not started,
Deliverable formats confirmed,Freelancer,Not started,
Source assets received,Client,Not started,
Feedback owner selected,Client,Not started,
Review rounds defined,Both,Not started,
Handover checklist agreed,Both,Not started,`,
          "handover.md": `# Project handover
- Final files and folder map:
- Version and completion date:
- Instructions for editing:
- Known limitations:
- Third-party assets and their licenses:
- Questions still open:
- Agreed follow-up contact and period:
Ask the client to confirm they can open and use each deliverable.`,
        },
      },
      {
        slug: "startup_launch_playbook", name: "Startup Launch Playbook", priceMinor: 6900,
        description: "A four-week product launch playbook with a readiness checklist, experiment tracker, and first-week review template.",
        instructions: "Start with playbook.md. Adapt the timeline to your team and track one clear experiment at a time in launch-plan.csv.",
        files: {
          "playbook.md": `# Four-week startup launch playbook
## Week 1: Define the promise
Write the target audience, the problem, and the smallest useful outcome.
Interview five people. Record evidence before choosing your launch message.
Choose one primary success measure, such as completed onboarding or first purchase.
## Week 2: Prepare the experience
Test signup, access recovery, the core workflow, and an empty account.
Check keyboard navigation and a narrow mobile screen.
Document price, delivery format, refunds, and support response expectations.
## Week 3: Rehearse
Ask three unfamiliar testers to complete the workflow without guidance.
Fix blocked steps before cosmetic issues. Prepare an outage message and rollback plan.
Confirm analytics distinguish visits, starts, completions, and failures.
## Week 4: Launch a small cohort
Invite a limited group through a channel they opted into.
Watch the first sessions, answer questions, and record the source of each problem.
Increase outreach only when the core experience is reliable.
## First-week review
What did users actually finish?
Which promise attracted the most relevant people?
Where did they stop and why?
Which experiment should we repeat, change, or stop?
## Decision log
Date | Evidence | Decision | Owner | Review date`,
          "launch-plan.csv": `Week,Task,Owner,Success measure,Status
1,Interview five target users,Founder,Five documented interviews,Not started
1,Write the product promise,Founder,One clear sentence,Not started
2,Test signup and purchase,Builder,Complete flow on mobile and desktop,Not started
2,Publish delivery and support details,Operations,All details visible,Not started
3,Run three usability sessions,Researcher,No blocked core steps,Not started
3,Rehearse recovery from an outage,Builder,Documented recovery,Not started
4,Invite the first cohort,Founder,Relevant opt-in participants,Not started
4,Review activation and feedback,Team,Next experiment selected,Not started`,
        },
      },
    ] },
    { id: "merchant_sample_pixel_pine", name: "Pixel & Pine Studio (Sample)", products: [
      {
        slug: "minimal_portfolio_template", name: "Minimal Portfolio Template", priceMinor: 2400,
        description: "A responsive HTML and CSS portfolio template with project cards, an about section, and accessible navigation. No framework required.",
        instructions: "Open index.html in your browser. Edit the placeholder projects and contact text, then adjust colors in styles.css. No external fonts or scripts are required.",
        files: {
          "index.html": page("Your name - Portfolio", `<header><strong>Your name</strong><nav aria-label="Main"><a href="#work">Work</a><a href="#about">About</a><a href="#contact">Contact</a></nav></header>
<main><section class="hero"><p class="eyebrow">Independent designer / Sample portfolio</p><h1>Thoughtful work.<br>Useful outcomes.</h1><p>I help small teams turn complex ideas into clear digital experiences.</p><a class="button" href="#work">Explore my work</a></section>
<section id="work"><h2>Selected projects</h2><div class="grid"><article><p class="eyebrow">Brand design</p><h3>North Studio</h3><p>Replace this sample with the challenge, your contribution, and the result.</p></article><article><p class="eyebrow">Product design</p><h3>Everyday Notes</h3><p>Show what changed and how you evaluated the outcome.</p></article><article><p class="eyebrow">Web design</p><h3>Field Journal</h3><p>Include a useful constraint and the decision it informed.</p></article></div></section>
<section id="about"><h2>About me</h2><p>Introduce your specialty, experience, and preferred collaborators here.</p></section><section id="contact"><h2>Have a project in mind?</h2><p>Replace this text with your preferred public contact details.</p></section></main>`),
          "styles.css": websiteStyles,
        },
      },
      {
        slug: "sage_brand_starter", name: "Sage Brand Starter Kit", priceMinor: 3900,
        description: "An editable sage-and-cream brand palette with SVG swatches, JSON design tokens, CSS variables, and typography guidance.",
        instructions: "Open palette.svg to inspect the colors. Import tokens.json into your own workflow or copy variables.css. Read brand-guide.md before adapting the palette.",
        files: {
          "tokens.json": JSON.stringify({ color: { ink: "#193A31", paper: "#F8F9F2", accent: "#D8ECA4", muted: "#60705E" }, radius: { small: "8px", large: "20px" }, spacing: [4, 8, 12, 16, 24, 32, 48, 64], fontFamily: "system-ui, sans-serif" }, null, 2),
          "variables.css": ":root { --brand-ink:#193a31; --brand-paper:#f8f9f2; --brand-accent:#d8eca4; --brand-muted:#60705e; --radius-small:8px; --radius-large:20px; }",
          "palette.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360" role="img" aria-label="Sage brand palette"><rect width="800" height="360" fill="#f8f9f2"/><g font-family="Arial" font-size="18" fill="#193a31"><text x="30" y="45">Sage / editable sample palette</text><rect x="30" y="80" width="160" height="190" rx="16" fill="#193a31"/><rect x="220" y="80" width="160" height="190" rx="16" fill="#d8eca4"/><rect x="410" y="80" width="160" height="190" rx="16" fill="#60705e"/><rect x="600" y="80" width="160" height="190" rx="16" fill="#ffffff" stroke="#193a31"/><text x="30" y="310">#193A31</text><text x="220" y="310">#D8ECA4</text><text x="410" y="310">#60705E</text><text x="600" y="310">#FFFFFF</text></g></svg>`,
          "brand-guide.md": `# Sage brand guide
## Tone
Use clear, calm language. Name the action a reader can take next.
## Color roles
Ink: headings and primary controls. Paper: page background.
Accent: limited emphasis. Muted: supporting content on a light background.
## Type
Use a system sans serif. Start with 16-18px body text and a 1.5-1.7 line height.
Keep paragraphs readable and headings short.
## Layout
Use spacing from the provided scale. Group related content and separate actions.
## Accessibility review
Measure contrast for each actual text/background pair before publishing.
Keep a visible keyboard focus indicator. Do not use color alone to communicate status.
SVG text stays editable; no font files or trademark rights are included.`,
        },
      },
      {
        slug: "social_post_layouts", name: "Social Post Layout Pack", priceMinor: 1500,
        description: "Three editable 1080px SVG social post templates for an announcement, a useful tip, and a featured quote.",
        instructions: "Open the SVG files in a vector editor or browser. Replace the sample copy and export PNGs for your chosen social platform.",
        files: {
          "announcement.svg": socialLayout("Something new.", "A little preview of what comes next.", "#f4e8dc", "#553a2e"),
          "useful-tip.svg": socialLayout("Make it useful.", "One small idea your audience can try today.", "#edf2df", "#284738"),
          "featured-quote.svg": socialLayout("Start with why.", "Then show someone how to take the next step.", "#e5ecf5", "#2b4260"),
        },
      },
    ] },
    { id: "merchant_sample_code_harbor", name: "Code Harbor (Sample)", products: [
      {
        slug: "responsive_pricing_page", name: "Responsive Pricing Page", priceMinor: 3200,
        description: "A framework-free HTML/CSS pricing page with three plan cards, a FAQ section, and mobile-friendly layouts.",
        instructions: "Open index.html locally. Edit the sample plans and link each call to action to your own checkout before publishing. The template does not process payments.",
        files: {
          "index.html": page("Your product - Pricing", `<header><strong>Your product</strong><nav aria-label="Main"><a href="#plans">Plans</a><a href="#faq">Questions</a></nav></header><main>
<section class="hero"><p class="eyebrow">Sample pricing template</p><h1>Room to begin.<br>Space to grow.</h1><p>Replace these illustrative plans with your actual offer and terms.</p></section>
<section id="plans" class="grid" aria-label="Plans"><article><h2>Starter</h2><p class="price">$9</p><p>Sample one-time price</p><ul><li>One project</li><li>Basic templates</li><li>Email support</li></ul><a class="button" href="#next-step">Explore Starter</a></article><article class="featured"><p class="eyebrow">For growing teams</p><h2>Studio</h2><p class="price">$29</p><p>Sample one-time price</p><ul><li>Five projects</li><li>Shared templates</li><li>Priority support</li></ul><a class="button" href="#next-step">Explore Studio</a></article><article><h2>Team</h2><p class="price">$59</p><p>Sample one-time price</p><ul><li>Twenty projects</li><li>Team guides</li><li>Setup session</li></ul><a class="button" href="#next-step">Explore Team</a></article></section>
<section id="faq"><h2>Questions</h2><details><summary>What is included?</summary><p>Replace this with the exact files, features, or services you provide.</p></details><details><summary>How do refunds work?</summary><p>Explain your actual refund terms and contact route.</p></details></section><section id="next-step"><h2>Ready for the next step?</h2><p>This sample has no checkout. Connect your own purchase flow before launch.</p></section></main>`),
          "styles.css": websiteStyles,
        },
      },
      {
        slug: "javascript_utilities", name: "JavaScript Utilities Pack", priceMinor: 2200,
        description: "Dependency-free JavaScript utilities for grouping, unique records, array chunks, and display currency, with runnable examples.",
        instructions: "Requires Node.js 18+ or a modern browser. Run node examples.mjs. Copy utilities.mjs into your own project and adapt the examples to your data.",
        files: {
          "utilities.mjs": `export function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
}
export function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) { const value = key(item); if (!groups.has(value)) groups.set(value, []); groups.get(value).push(item); }
  return groups;
}
export function chunk(items, size) {
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('size must be a positive integer');
  const groups = []; for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size)); return groups;
}
export function formatUsd(cents, locale = 'en-US') {
  if (!Number.isSafeInteger(cents)) throw new RangeError('cents must be a safe integer');
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
}`,
          "examples.mjs": `import assert from 'node:assert/strict';
import { uniqueBy, groupBy, chunk, formatUsd } from './utilities.mjs';
const products = [{ id: 1, type: 'book' }, { id: 1, type: 'book' }, { id: 2, type: 'template' }];
assert.equal(uniqueBy(products, p => p.id).length, 2);
assert.equal(groupBy(products, p => p.type).get('book').length, 2);
assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.throws(() => chunk([1], 0), RangeError);
assert.equal(formatUsd(2499), '$24.99');
console.log('All sample utility examples passed.');`,
        },
      },
      {
        slug: "api_integration_checklist", name: "API Integration Checklist", priceMinor: 1200,
        description: "A practical API integration workbook covering request contracts, pagination, timeouts, retries, and failure handling.",
        instructions: "Work through integration-guide.md and record outcomes in test-matrix.csv. Examples use fictional endpoints and require your own API documentation.",
        files: {
          "integration-guide.md": `# API integration workbook
## Before coding
- Identify the base URL, supported version, and authentication method.
- List required fields, optional fields, and expected response types.
- Keep credentials on the server and outside logs.
## Request behavior
- Set a bounded timeout and handle cancellation.
- Read the documented pagination cursor; stop when no next cursor is returned.
- Respect rate limits and Retry-After.
- Retry safe reads with bounded backoff. Do not blindly retry writes.
- Use a documented idempotency key when repeating supported mutations.
## Response behavior
- Validate the content type and response shape before using data.
- Distinguish rejected credentials, validation errors, rate limits, and unavailable services.
- Display a useful error and preserve the user's input.
## Example contract
GET /v1/example-items?cursor=next-page
Success: { "items": [{ "id": "example-1", "name": "Sample" }], "nextCursor": null }
Failure: { "error": { "code": "RATE_LIMITED", "retryable": true } }
These are illustrative shapes, not a real provider contract.
## Release checklist
Run the matrix, document recovery behavior, and confirm no secrets appear in browser assets.`,
          "test-matrix.csv": `Scenario,Expected behavior,Observed result,Pass
Successful read,Validate and display data,,
Empty result,Show a useful empty state,,
Expired credentials,Require sign-in again,,
Validation failure,Show field-specific feedback,,
Rate limit,Respect Retry-After,,
Network timeout,Allow a safe retry,,
HTML error response,Handle without JSON crash,,
Repeated write,Use provider-supported idempotency,,`,
        },
      },
    ] },
    { id: "merchant_sample_papertrail", name: "Papertrail Productivity (Sample)", products: [
      {
        slug: "weekly_focus_planner", name: "Weekly Focus Planner", priceMinor: 900,
        description: "A lightweight weekly planning kit with a CSV focus planner, habit tracker, and a ten-minute weekly review.",
        instructions: "Open the CSV files in Excel, Google Sheets, or another spreadsheet app. Duplicate the week before editing. Start with one priority each day.",
        files: {
          "weekly-planner.csv": `Day,Top priority,First small action,Focus block,Must finish,Reflection
Monday,Choose the week's outcome,Write a clear result,09:00-10:00,One useful draft,
Tuesday,,,,,
Wednesday,,,,,
Thursday,,,,,
Friday,,,,,
Saturday,,,,,
Sunday,Review and plan,Read the completed tasks,17:00-17:10,Next week's priority,`,
          "habit-tracker.csv": `Habit,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday
Plan one priority,,,,,,,
Take a screen break,,,,,,,
Read for ten minutes,,,,,,,
Write a short reflection,,,,,,,`,
          "weekly-review.md": `# Ten-minute weekly review
1. What moved forward? Record outcomes rather than hours spent.
2. What remained unfinished? Keep, reduce, delegate, or remove it.
3. What interrupted focus? Choose one practical change.
4. What deserves rest or recovery time next week?
5. Choose one priority and the smallest first action.
Leave space in the calendar for unexpected work.`,
        },
      },
      {
        slug: "freelance_project_tracker", name: "Freelance Project Tracker", priceMinor: 1800,
        description: "Spreadsheet-ready project, milestone, and workload trackers for managing several freelance jobs without a subscription.",
        instructions: "Import each CSV as a separate sheet. Replace the illustrative project with your work, and review milestones with your client each week.",
        files: {
          "projects.csv": `Project,Client alias,Outcome,Start date,Target date,Status,Next step
Portfolio refresh,Example client,Publish three case studies,,,Discovery,Confirm deliverables
,,,,,,
,,,,,,`,
          "milestones.csv": `Project,Milestone,Owner,Due date,Acceptance criteria,Status
Portfolio refresh,Outline,Designer,,Three case-study outlines reviewed,Not started
Portfolio refresh,First draft,Designer,,Readable mobile and desktop drafts,Not started
Portfolio refresh,Review,Client,,Consolidated feedback received,Not started
Portfolio refresh,Handover,Designer,,Files and editing instructions delivered,Not started`,
          "workload.csv": `Week,Project,Planned hours,Actual hours,Blocked by,Adjustment
1,Portfolio refresh,6,0,,
2,Portfolio refresh,8,0,,
3,Portfolio refresh,4,0,,`,
        },
      },
      {
        slug: "content_calendar_toolkit", name: "Content Calendar Toolkit", priceMinor: 2700,
        description: "A four-week content calendar with channel planning, reusable post prompts, and an editorial review checklist.",
        instructions: "Fill calendar.csv with topics your audience asked about. Use editorial-checklist.md before publishing and record results weekly.",
        files: {
          "calendar.csv": `Week,Format,Topic prompt,Audience need,Owner,Status,Outcome
1,Short post,Answer a frequently asked question,Understand the basics,,Idea,
1,Newsletter,Share one useful process,Try a practical step,,Idea,
2,Short post,Explain a common mistake,Avoid wasted effort,,Idea,
2,Article,Walk through an example,See how it works,,Idea,
3,Short post,Show a before-and-after decision,Compare approaches,,Idea,
3,Newsletter,Share a lesson from feedback,Improve their process,,Idea,
4,Short post,Invite relevant questions,Choose the next topic,,Idea,
4,Article,Summarize the month's useful ideas,Find the best resources,,Idea,`,
          "editorial-checklist.md": `# Editorial review
- Can the reader tell who this is for?
- Is the main promise specific and supported?
- Have factual claims been checked against current sources?
- Are borrowed quotations and assets attributed and permitted?
- Does the piece include a useful example?
- Is there one clear next step?
- Do images have useful alt text?
- Are headings, links, and mobile layouts readable?
- Is the audience expecting this message?
## Weekly review
Record useful replies, completed actions, and unanswered questions.
Choose the next topic from evidence rather than publishing volume alone.`,
        },
      },
    ] },
    { id: "merchant_sample_brightside", name: "Brightside Growth (Sample)", products: [
      {
        slug: "launch_email_kit", name: "Product Launch Email Kit", priceMinor: 2100,
        description: "Five editable product launch email templates with subject-line alternatives, audience notes, and a message review checklist.",
        instructions: "Adapt the templates to an audience that opted into hearing from you. Replace every bracketed placeholder and use only claims you can substantiate.",
        files: {
          "email-templates.md": `# Product launch email kit
## 1. Preview
Subject: A simpler way to [specific task]
Hi [name], we are preparing [product] for people who [audience need].
It helps you [specific outcome]. Here is an early example: [example].
If this is relevant, [one optional next step].
## 2. Launch
Subject: [Product] is ready to try
You can now [core task] with [product].
Included: [exact deliverables]. Price: [actual price]. Delivery: [actual timing].
Explore the details: [link]. Questions? [support contact].
## 3. Useful walkthrough
Subject: Your first [outcome] in three steps
1. [First action]
2. [Second action]
3. [How to confirm success]
See the full example: [link].
## 4. Questions answered
Subject: A few questions about [product]
Who is it for? [Specific audience]
What is included? [Precise scope]
What if it does not fit? [Actual refund terms]
## 5. Follow-up
Subject: What should we improve next?
If you tried [product], what helped and what was confusing?
Reply with one thing you would change. Thank you for helping us improve.
## Review before sending
Remove unsupported claims and invented urgency. Check all links and prices.
Use your email provider's consent, unsubscribe, and privacy controls.`,
        },
      },
      {
        slug: "seo_content_brief", name: "SEO Content Brief Kit", priceMinor: 2500,
        description: "A search-focused article brief, topic map, and content quality checklist for planning useful pages around reader intent.",
        instructions: "Choose a real audience question, complete brief.md, and organize related topics in topic-map.csv. This template does not promise search rankings.",
        files: {
          "brief.md": `# Content brief
## Reader and intent
Who is searching? What are they trying to learn or complete?
Primary question:
Related questions:
Experience level:
## Proposed page
Working title:
One-sentence answer:
Suggested sections:
Original example or demonstration:
## Evidence plan
Claims requiring verification:
Primary sources and dates:
Subject matter reviewer:
## Useful differentiation
What can this page explain, show, or test that existing pages do not?
## Publishing review
Use a descriptive title, clear headings, meaningful links, and readable text.
Explain terms before using abbreviations. Add alt text to meaningful images.
## After publishing
Review actual reader questions and search intent. Update stale material.
No ranking or traffic outcome is guaranteed by this sample.`,
          "topic-map.csv": `Topic,Reader question,Intent,Proposed format,Supporting example,Status
Getting started,How do I begin?,Learn,Step-by-step guide,Small worked example,Idea
Comparison,Which approach fits me?,Compare,Decision guide,Real tradeoffs,Idea
Troubleshooting,Why did this fail?,Resolve,Checklist,Observed error and fix,Idea
Next steps,How do I improve?,Practice,Workbook,Measurable experiment,Idea`,
        },
      },
      {
        slug: "customer_research_sprint", name: "Customer Research Sprint", priceMinor: 5900,
        description: "A five-day customer research sprint with recruitment guidance, a usability session script, and a prioritized findings board.",
        instructions: "Read sprint-guide.md, adapt the session to your product, and fill findings.csv using observed evidence. This is a self-guided digital toolkit, not a commissioned research service.",
        files: {
          "sprint-guide.md": `# Five-day customer research sprint
## Day 1: Frame
Choose one decision the team needs to make. Write what evidence would change it.
Define relevant participant characteristics without collecting unnecessary personal information.
## Day 2: Recruit and prepare
Invite people through appropriate opt-in channels. Explain the purpose, duration, and note-taking process.
Prepare realistic tasks and a working prototype or product.
## Day 3: Observe
Ask the participant to think aloud. Avoid teaching them how to complete a task.
Capture what they do separately from what you infer.
## Day 4: Synthesize
Group repeated observations. Include counterexamples and uncertain findings.
Rate severity by impact on the task, frequency observed, and available workaround.
## Day 5: Decide
Select the smallest changes likely to address the strongest evidence.
Assign an owner, success measure, and review date to each change.
## Twenty-minute session script
Welcome and permission to take notes (2 minutes).
Context: how do you currently complete this task? (3 minutes).
Task: imagine you need [outcome]. Show how you would begin (10 minutes).
Reflection: what was unclear and what did you expect? (5 minutes).
## Limits
A small qualitative sample finds problems; it does not establish population-wide percentages.`,
          "findings.csv": `Finding,Observed evidence,Participants,Impact,Confidence,Proposed change,Owner,Review date
Example only: unclear next step,Participant paused after opening a product,P01,Task blocked,Low,Test a clearer action label,,
,,,,,,,
,,,,,,,`,
        },
      },
    ] },
    { id: "merchant_sample_storyloom", name: "Storyloom Press (Sample)", products: [
      {
        slug: "short_story_workbook", name: "Short Story Starter Workbook", priceMinor: 1400,
        description: "A creative writing workbook with character prompts, a five-scene story planner, and practical revision exercises.",
        instructions: "Write directly in story-workbook.md or copy its prompts into your preferred editor. Complete a rough five-scene draft before polishing sentences.",
        files: {
          "story-workbook.md": `# Short story starter workbook
## Start with a character
What do they want today? What are they reluctant to admit?
What small habit reveals their priorities?
## Add pressure
Choose a place they cannot easily leave and a decision they cannot postpone.
Prompt: A familiar package arrives with the wrong person's name and a note only the character understands.
## Five-scene planner
1. Ordinary moment: show what matters to the character.
2. Disruption: introduce information that changes the goal.
3. Attempt: let the first solution create a new complication.
4. Choice: force a decision with a meaningful tradeoff.
5. Aftermath: show what changed through one concrete detail.
## Dialogue exercise
Write a conversation where each person wants something different.
Remove every line that merely repeats information both people know.
## Setting exercise
Describe the same room first as welcoming, then as unsettling, using only observable details.
## Revision pass
Underline the action that changes each scene.
Replace vague emotion labels with a revealing behavior where useful.
Read dialogue aloud. Cut explanations already shown through action.
## Reflection
What did the character choose? What does the last image let the reader infer?`,
        },
      },
      {
        slug: "newsletter_writing_kit", name: "Newsletter Writing Kit", priceMinor: 1700,
        description: "Reusable newsletter structures for a practical lesson, a personal field note, and a curated reading list.",
        instructions: "Choose a structure in newsletter-structures.md and fill the outline before drafting. Use the editing checklist to keep each issue focused.",
        files: {
          "newsletter-structures.md": `# Newsletter writing kit
## Structure 1: One useful lesson
Opening: name a situation your reader recognizes.
Insight: explain one idea in plain language.
Example: show the idea in a concrete, limited case.
Action: suggest a small step the reader can try.
Question: invite a relevant reply.
## Structure 2: Field note
What I attempted:
What actually happened:
What surprised me:
What I would change next time:
Why this may be useful to you:
## Structure 3: Curated reading list
Theme: one question connecting the selections.
For each item: title, author, original link, and your own short explanation of why it matters.
Avoid reproducing large passages from other writers.
## Subject line exercises
Write five alternatives: a specific outcome, a question, a concrete observation, a short lesson, and an unexpected detail.
Choose the one that accurately reflects the issue.
## Editing checklist
Keep one central promise. Define unfamiliar terms. Cut a repeated point.
Check facts and links. Make the first useful sentence easy to find.
Send through a service that supports the audience's consent and unsubscribe choices.`,
        },
      },
      {
        slug: "creator_storytelling_course", name: "Creator Storytelling Mini-Course", priceMinor: 4500,
        description: "A self-paced four-lesson writing course with exercises on audience, structure, concrete examples, and revision.",
        instructions: "Work through course.md in order, allowing 20-30 minutes per lesson. Use practice-plan.csv to record drafts and revisions. This is a text course; no video or coaching is included.",
        files: {
          "course.md": `# Creator storytelling mini-course
## Lesson 1: Know the reader's task
A useful piece begins with what the reader is trying to understand or do.
Exercise: name one reader, one situation, and one question. Write a two-sentence promise.
Review: would that reader recognize themselves without a demographic label?
## Lesson 2: Give the piece a direction
Use a simple sequence: situation -> obstacle -> decision -> result -> reflection.
Exercise: outline a real experience in five sentences, one for each step.
Review: does the decision follow from the obstacle? Is the result specific?
## Lesson 3: Make the example concrete
Replace general praise with observable details and a clear scope.
Weak: The new process was amazing.
Stronger: The team replaced three status meetings with one written update and reviewed the effect after two weeks.
Exercise: rewrite three vague sentences using details you can verify.
Review: remove any number, quote, or result you cannot support.
## Lesson 4: Revise for the reader
First check the argument, then the paragraph order, then individual sentences.
Exercise: summarize each paragraph in the margin. Remove or move a paragraph that does not support the promise.
Read aloud and replace words that obscure the meaning.
Review: can the reader identify what happened, why it mattered, and what to consider next?
## Final assignment
Write a 400-word field note about one real decision. Ask a reader to summarize its main point.
Revise the part they found confusing and keep both versions in your practice folder.`,
          "practice-plan.csv": `Lesson,Exercise,Draft date,Feedback,Revision date,Next step
1,Write the reader promise,,,,
2,Outline five story steps,,,,
3,Replace three vague sentences,,,,
4,Review paragraph purpose,,,,
Final,Write and revise a field note,,,,`,
        },
      },
    ] },
  ];
}
