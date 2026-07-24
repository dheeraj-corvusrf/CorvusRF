export type Module = {
  id: string;
  n: number;
  title: string;
  question: string;
  status: "Analyzing" | "Completed" | "Additional Data Needed";
  teaser: string;
  requiresUserData?: boolean;
};

export const MODULES: Module[] = [
  {
    id: "health",
    n: 1,
    title: "AI Property Health Score",
    question: "Should I protest my property?",
    status: "Completed",
    teaser: "AI-generated protest opportunity score based on your property's official CAD valuation record.",
  },
  {
    id: "strategy",
    n: 2,
    title: "AI Recommended Protest Strategy",
    question: "What is the best strategy to reduce my property taxes?",
    status: "Completed",
    teaser: "AI-recommended approach — market value, unequal appraisal, or condition-based reduction — for your CAD record.",
  },
  {
    id: "comps",
    n: 3,
    title: "Comparable Sales & Market Analysis",
    question: "How does my property compare with similar nearby commercial properties?",
    status: "Completed",
    teaser: "AI guidance on what comparable-sale and equity evidence to gather for this property type and county.",
  },
  {
    id: "site",
    n: 4,
    title: "Site Condition Analysis",
    question: "Are there land or site-related issues that could support a lower valuation?",
    status: "Completed",
    teaser: "AI checklist of site factors — access, drainage, easements — worth documenting for this property type.",
  },
  {
    id: "improvement",
    n: 5,
    title: "Improvement Condition Analysis",
    question: "Is the building being valued fairly based on its age and condition?",
    status: "Completed",
    teaser: "AI checklist of condition and functional-obsolescence factors worth documenting for this property.",
  },
  {
    id: "zoning",
    n: 6,
    title: "Zoning & Property Classification Review",
    question: "Is the property being assessed under the correct zoning and classification?",
    status: "Completed",
    teaser: "AI assessment of whether your CAD classification appears consistent with the stated property type.",
  },
  {
    id: "income",
    n: 7,
    title: "Income Approach & P&L Analysis",
    question: "Does the property's income support its current assessed value?",
    status: "Additional Data Needed",
    teaser: "Requires P&L, rent roll, or operating statement to complete.",
    requiresUserData: true,
  },
  {
    id: "evidence",
    n: 8,
    title: "AI Evidence Builder",
    question: "What evidence may provide the strongest support for a protest?",
    status: "Completed",
    teaser: "AI-prioritized evidence checklist for your protest packet.",
  },
  {
    id: "savings",
    n: 9,
    title: "Estimated Tax Savings & ROI",
    question: "How much could I potentially save, and is filing a protest worthwhile?",
    status: "Completed",
    teaser: "AI-estimated value reduction and tax savings based on your assessed value.",
  },
  {
    id: "executive",
    n: 10,
    title: "AI Executive Protest Report",
    question: "What is the final AI recommendation and what should I do next?",
    status: "Completed",
    teaser: "AI executive summary with a recommended next step, synthesized from the other modules.",
  },
];
