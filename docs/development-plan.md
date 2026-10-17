# Fatherhood.School Development Plan

**Version:** 1.0  
**Date:** October 17, 2026  
**Prepared for:** Nique Fajors  
**Intended Audience:** Claude Code / Development Team  
**Domain:** fatherhood.school  
**Mission:** Address the national emergency of father absence by providing high-quality, accessible education for fathers and men considering fatherhood. Launch in tandem with the book *Fatherhood in Focus*.

## 1. Executive Summary

Fatherhood.School is a subscription-based online academy for fathers and aspiring fathers, modeled after the high-production, intellectually rigorous style of Peterson Academy while incorporating practical, evidence-based content drawn from *Fatherhood in Focus* and original contributions from selected fathers.

**Core Offerings:**
- **Professional Academy (Paid):** High-quality, structured video courses. Unlimited access for $199/year or $19/month.
- **Community Voices (Free):** User-submitted short videos from approved creators, free to view (to drive awareness and funnel to paid).
- Robust creator upload system with standardized branding (watermarks, intros/outros).
- Video ratings and reviews.
- Creator revenue share: 55% of attributable operating profit.
- AI + human moderation.
- Gift memberships.
- Integration with book launch (excerpts, author-led courses, companion materials).

**Revenue Targets:**
- Year 1: $100,000
- Year 2: $500,000
- Year 4: $2,000,000 (stable)

**Recommended Tech Stack (2026):**
- Frontend/Full-stack: Next.js 15+ (App Router, React Server Components, TypeScript)
- Styling: Tailwind CSS 4 + shadcn/ui
- Auth: Better Auth or Clerk
- Database: PostgreSQL (Supabase or Neon) + Drizzle ORM
- Payments: Stripe (subscriptions, gifts, customer portal)
- Video: Cloudflare Stream (upload, encode, store, deliver, watermarks, signed URLs, player)
- File Storage: Cloudflare R2 (supporting assets, PDFs, workbooks)
- Hosting/CDN: Cloudflare Pages / Workers (or Vercel with Cloudflare Stream)
- AI: OpenAI / Anthropic for moderation, captions, recommendations
- Email: Resend or Loops
- Analytics: PostHog or Cloudflare Web Analytics + Stream analytics

This document provides complete specifications so Claude Code can implement the platform with minimal further clarification.

## 2. Market Assessment & Competitive Analysis

### Existing Fatherhood Education Landscape
The market is fragmented and largely underserved for high-quality, scalable digital education aimed at individual fathers:

| Provider | Model | Pricing | Strengths | Weaknesses | Opportunity for Us |
|----------|-------|---------|-----------|------------|--------------------|
| National Fatherhood Initiative (24/7 Dad®, ProFathering15™) | Curriculum sold to organizations; some self-paced digital | $15/dad (ProFathering15) or $899+ for facilitator kits | Evidence-based, widely used by nonprofits | B2B focus, limited direct-to-consumer polish | Consumer-grade, cinematic production + direct access |
| The Dad School | Small live cohorts | ~$699 for 6 weeks | Psychologist-led, high touch | Expensive, limited scale, live only | Scalable on-demand + community |
| Fathercraft / Father's Ed | One-time digital course | $99–$129 | Practical checklists for new dads | Narrow (new dads only), one-off | Ongoing academy + broader stages of fatherhood |
| Prepared Dad, Dad Ready, Journey to Fatherhood | Free or low-cost workshops/courses | Free–£395 | Accessible entry points | Variable quality, limited depth | Premium production + free teaser section |
| Fathers.com / National Center for Fathering | Articles, radio, membership | Mixed | Longstanding brand | Dated digital experience | Modern video-first platform |
| Peterson Academy | Annual subscription | ~$399–$599/year | High production, faculty prestige, community (The Quad), monthly releases | General education, not fatherhood-specific | Domain expertise + book synergy |
| MasterClass | Annual subscription | ~$120/year | Celebrity instructors, cinematic quality | Entertainment-leaning, not deep skill-building | Practical + research-backed fatherhood focus |
| Teachable / Kajabi / Thinkific | Creator platforms | Monthly SaaS + optional fees | Easy to launch courses | Generic, no built-in audience or curation | Curated academy with revenue share + free layer |

**Key Gaps Identified:**
- No premium, scalable, video-first “academy” dedicated exclusively to fatherhood with both professional and peer content.
- Most programs are either free/low-quality, organizational, or expensive live cohorts.
- High demand exists (1 in 4 U.S. children in father-absent homes; strong interest in practical skills, research, and peer stories).
- Book launch provides unique content moat and marketing engine.

**Best Practices to Adopt:**
- From Peterson Academy: Clean academic aesthetic, structured courses with optional quizzes, community discussion, monthly content cadence, gift option, money-back guarantee, self-paced with progress tracking, mobile/offline capable.
- From MasterClass: Cinematic production standards for professional videos, bite-sized lessons (10–15 min preferred), downloadable workbooks/PDFs, high-quality player.
- From modern platforms: Stripe subscriptions + customer portal, signed video URLs for paid content, AI captions, ratings/reviews, analytics for creators.
- Revenue models: Avoid pure marketplace (Udemy-style heavy cuts); use hybrid with curated professional content + controlled creator share.

## 3. Product Vision & Feature Specifications

### 3.1 Content Architecture
Two distinct sections:

**A. Professional Academy (Paid Access Required)**
- Structured courses (modules + lessons).
- High production value (studio or polished remote).
- Typical lesson length: 8–20 minutes (courses 2–8 hours total).
- Supporting materials: PDFs, workbooks, reflection exercises, key insight cards (drawn from book).
- Optional quizzes and certificates of completion.
- Examples: Author-led courses based on book chapters (Voices of Fatherhood, Why Fathers Matter, Lessons from Around the World, etc.), expert interviews, case studies.

**B. Community Voices (Free to View)**
- User-submitted short videos from vetted creators (“Fellows” or approved fathers).
- Maximum length: 8 minutes (hard limit enforced at upload to control costs and focus content).
- Topics: Personal stories, practical tips, reflections on book themes, “what I wish I knew,” co-parenting, presence, etc.
- Free for all visitors (login optional for ratings/comments).
- Purpose: SEO, social sharing, lead generation, community building.
- Still moderated and branded.

**C. Book Integration**
- Dedicated landing/section for *Fatherhood in Focus*.
- Excerpts, author notes, companion videos.
- Early access or bonuses for book buyers (promo codes).
- Courses that expand on book case studies (Aka fathers, MLK Sr., Lincoln, DAD MAP, etc.).

### 3.2 Core User Features
- **Membership:**
  - Annual: $199 (best value, recommended default).
  - Monthly: $19.
  - 7-day money-back guarantee.
  - Gift memberships: Purchase as gift (email delivery of code or direct account provisioning). Stripe-powered.
  - Family / multi-seat options (future, Year 2+).
- **Video Player (Cloudflare Stream):**
  - Adaptive bitrate, captions (AI-generated + editable).
  - Speed control, picture-in-picture, offline download (mobile app later).
  - Progress tracking, resume.
  - Watermark / logo overlay (standardized branding).
  - Clip creation / share (for social, with attribution).
- **Ratings & Reviews:**
  - 1–5 star rating + optional written review per video.
  - Aggregate scores visible on cards and detail pages.
  - Sort/filter by rating, newest, most viewed.
  - Helpful votes on reviews.
- **Progress & Learning:**
  - Course progress bars, completion badges.
  - Personal “My Learning” dashboard.
  - Recommended next based on watched content and ratings.
- **Community (Phase 1 lightweight):**
  - Comments under videos.
  - Optional discussion threads.
  - Full “Quad”-style social feed in Phase 2.
- **Search & Discovery:**
  - Full-text search across titles, descriptions, transcripts.
  - Categories: Expectant, New Dads, School-age, Teens, Co-parenting, Presence, Discipline, Work-Family, Research, Personal Stories, etc.
  - Curated playlists (e.g., “Start Here,” “Book Companion”).

### 3.3 Creator System (“Selected Fathers” / Fellows)
- Application / invitation process for upload privileges.
- Once approved:
  - Direct upload from any device (web, mobile browser).
  - Cloudflare Stream direct upload URLs.
  - Automatic application of standard watermark (logo + “fatherhood.school”).
  - Optional standardized intro/outro bumper (5–10 sec, generated or pre-rendered).
  - Metadata: title, description, tags, category, transcript upload or AI generation.
  - Length validation (reject or truncate >8 min for Community; professional can be longer).
- Dashboard for creators: views, watch time, ratings, estimated earnings, upload status.
- Branding standardization is mandatory — no custom intros that break visual consistency.

### 3.4 Moderation & Approval
**Hybrid AI + Human:**
1. **AI Pre-screening (automatic on upload):**
   - Length check.
   - Content moderation (OpenAI Moderation API or equivalent): hate, violence, sexual content, spam.
   - Relevance scoring: keywords + LLM classification against fatherhood themes.
   - Technical quality signals: audio clarity, resolution, face presence (optional).
   - Auto-approve high-confidence clean + relevant short videos; flag others.
2. **Human Review Queue:**
   - Admin dashboard for pending videos.
   - Approve / Reject / Request changes.
   - SLA: 24–48 hours for Community; longer for professional.
3. **Post-publish:**
   - User reports → AI + human escalation.
   - Ability to unpublish or restrict.

**Policies:** Content must be constructive, non-political in the culture-war sense unless directly tied to fatherhood evidence, respectful of mothers/co-parents, no medical/legal advice without disclaimers.

### 3.5 Revenue Sharing Model (Detailed)
**Principle:** Creators receive 55% of the *operating profit attributable to their video*.

**Definitions (to be implemented precisely):**
- **Gross Revenue Pool:** All subscription revenue (monthly + annual) in a period (monthly or quarterly settlement).
- **Variable Costs Allocated:**
  - Stripe fees (~2.9% + $0.30, or exact).
  - Cloudflare Stream storage + delivery costs allocated proportionally by minutes delivered.
  - Payment processing, refunds, chargebacks.
- **Operating Profit (OP) for Content Pool:** Gross subscription revenue − variable costs − a fixed platform overhead allocation (recommend 25–35% of remaining for platform, marketing, ops, development reserve). The remaining is the “Content OP Pool.”
- **Attribution:**
  - Primary metric: Minutes watched (or views weighted by completion rate).
  - Secondary: Ratings (higher-rated content gets small multiplier, e.g., 1.0–1.2x).
  - Each video’s share of total minutes watched determines its share of the Content OP Pool.
- **Creator Payout:** 55% of the video’s attributed OP.
- **Platform retains:** 45% of attributed OP + all overhead.

**Example Calculation (illustrative):**
- Monthly gross: $20,000
- Variable costs: $2,000
- Overhead allocation (30%): $5,400
- Content OP Pool: $12,600
- Video A accounts for 5% of minutes watched → attributed OP $630
- Creator receives 55% × $630 = $346.50

**Implementation Notes for Claude Code:**
- Track watch time per user per video (Cloudflare Stream analytics + internal events).
- Monthly settlement job.
- Creator dashboard shows estimated and actual payouts.
- Minimum payout threshold ($50) and Stripe Connect or ACH for payouts.
- Transparent reporting so creators understand the model.
- Professional course creators (including author) participate in the same system or a separate higher-share tier if desired (decide later; default to same for simplicity).

This model is fair, aligns incentives with quality and engagement, and scales with company success.

## 4. Revenue Model & Projections

**Pricing Strategy:**
- $199 annual (primary, ~$16.58/mo effective).
- $19 monthly (convenience).
- Gift purchases at same rates.
- Annual preferred in marketing (higher LTV, lower churn).

**Year 1 Target: $100,000**
- Average blended ARPU: ~$150–$180 (mix of annual/monthly + churn).
- Need ~550–670 paying subscribers by end of year (or higher early with annuals).
- Primary drivers: Book launch audience, Substack (nique.substack.com), podcast (*The Invisible Men*), speaking, LinkedIn, targeted ads, free Community content SEO/social.
- Free Community videos as top-of-funnel.

**Year 2: $500,000**
- Scale content library, improve conversion, add retention features (community, certificates, mobile app).
- ~2,500–3,000 subscribers.

**Year 4: $2,000,000**
- Mature library (100+ professional hours + hundreds of Community), strong organic + referral, possible B2B licensing to organizations (universities, nonprofits, military).
- ~10,000–12,000 subscribers at blended rates.

**Cost Considerations:**
- Cloudflare Stream is highly cost-effective at moderate scale.
- Content production is the main variable (professional videos).
- Keep fixed costs low via Cloudflare stack.

## 5. Technical Architecture & Implementation Guidance

### 5.1 Recommended Stack
- **App:** Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
- **Auth:** Better Auth (or Clerk) — email/password + Google; session management; role-based (user, creator, admin)
- **DB:** PostgreSQL + Drizzle ORM
- **Video:** Cloudflare Stream
  - Direct uploads via one-time URLs
  - Watermark profiles for branding
  - Signed URLs for paid content
  - Webhooks for processing status
  - Analytics API for watch time
- **Payments:** Stripe Billing (subscriptions), Checkout, Customer Portal, Gift via promo codes or metadata
- **Storage:** R2 for PDFs, images, workbooks
- **AI:** 
  - Moderation: OpenAI Moderation
  - Captions/transcripts: Whisper or Cloudflare Stream AI captions
  - Recommendations: simple collaborative filtering or LLM-based later
- **Email:** Resend
- **Deployment:** Cloudflare Pages + Workers, or Vercel + Cloudflare Stream

### 5.2 Key Data Models (High-Level)
- Users (roles: free, subscriber, creator, admin)
- Subscriptions (Stripe synced)
- Courses / Modules / Lessons
- Videos (type: professional | community; status: pending | approved | rejected; cloudflare_id; duration; watermark_applied)
- Ratings / Reviews
- WatchProgress
- CreatorPayouts
- Gifts
- Comments

### 5.3 Critical Flows
1. **User Registration / Purchase** → Stripe Checkout → webhook → grant access.
2. **Gift Purchase** → generate unique code → email recipient → redeem.
3. **Creator Upload** → generate Stream upload URL → client uploads → webhook → AI moderation → human queue or auto-approve → apply watermark → publish.
4. **Video Playback** → check entitlement → generate signed URL if paid → embed Stream player.
5. **Rating** → store + update aggregates.
6. **Monthly Settlement** → calculate attributable OP → create payout records.

### 5.4 Branding & Design Direction
- Clean, serious, modern academic aesthetic (inspired by Peterson Academy but warmer/more approachable for fathers).
- Color palette: Deep navy, warm gold/amber accents, clean whites, high contrast for readability.
- Typography: Strong serif for headings (authority), clean sans for body.
- Logo: Simple, strong wordmark “Fatherhood.School” with subtle father-child or mountain motif (reference book proverb).
- All videos carry consistent lower-third or corner watermark.
- Professional videos should feel high-production; Community videos feel authentic but polished via branding.

### 5.5 Security & Compliance
- Signed video URLs (expire quickly).
- Role-based access.
- COPPA considerations if any minor content (avoid).
- Privacy policy, terms (especially content licensing for uploads).
- GDPR/CCPA ready.

## 6. Development Roadmap for Claude Code

**Phase 1 – MVP (Launch-ready for book, target 8–12 weeks)**
- Marketing site + book landing.
- Auth + Stripe subscriptions (monthly/annual) + gift flow.
- Professional content catalog (admin upload + structured courses).
- Community upload system with AI + basic human queue.
- Video player with watermark, ratings, progress.
- Basic search, categories, free/paid gates.
- Creator dashboard (basic).
- Admin moderation tools.
- Revenue share calculation (backend, even if payouts manual at first).

**Phase 2 – Growth (Months 4–9)**
- Enhanced community (comments, better discovery).
- Certificates, quizzes.
- Mobile-responsive excellence + PWA.
- Email sequences, recommendations.
- Automated payouts (Stripe Connect).
- Analytics dashboards.

**Phase 3 – Scale (Year 2+)**
- Native mobile apps (offline).
- Full social features.
- B2B licensing portal.
- Advanced AI (personalized paths, AI coaching companion).
- International expansion.

**Immediate Priorities for Claude Code:**
1. Scaffold Next.js app with auth, DB, Stripe.
2. Integrate Cloudflare Stream (upload + playback + watermarks).
3. Build content models and admin tools.
4. Implement entitlement logic.
5. Create polished public pages and video library UI.
6. Build moderation pipeline.

## 7. Content & Launch Strategy

- **Book Synergy:** Launch platform with 3–5 professional courses derived from book chapters + author intro series. Offer book buyers exclusive early access or discount codes.
- **Initial Professional Content:** Author-produced + select expert interviews (economists, anthropologists, clinicians who appear in research).
- **Community Seeding:** Invite 20–50 high-quality fathers (from network, podcast guests, HBS survey respondents) as founding Fellows with upload access.
- **Marketing:** Substack, podcast cross-promotion, LinkedIn, targeted ads to new/expectant dads, partnerships with fatherhood nonprofits (non-competitive angle).
- **Free Layer as Growth Engine:** Optimize Community videos for YouTube/TikTok/Instagram cross-posting (with branding).

## 8. Success Metrics
- Subscribers and MRR/ARR.
- Conversion rate free → paid.
- Watch time and completion rates.
- Creator retention and content volume.
- NPS / ratings.
- Churn rate.
- Book sales attribution.

## 9. Open Decisions & Recommendations
- **Default recommendation:** Start with annual-heavy marketing and the revenue share model as defined.
- **Video length (Community):** 8 minutes hard max.
- **Guarantee:** 7 days.
- **First professional courses:** Prioritize book-aligned content for launch.
- **Overhead allocation:** Start at 30% until real data; review quarterly.
- **Name the free section:** “Community Voices” or “Dad Voices.”

This plan is comprehensive, actionable, and aligned with the stated vision, pricing, revenue targets, and technical constraints. Claude Code should treat this as the source of truth and implement with production-quality code, clear comments, and modular architecture.

**Next Step:** Scaffold the project and begin Phase 1 core flows.  
**Contact for clarifications:** Nique Fajors
