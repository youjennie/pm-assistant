import { useState, useCallback, useRef, useEffect, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Zap, Copy, Check, X, Settings,
  FileText, MessageSquare, HelpCircle, AlertTriangle, Search, Loader2, Upload,
  LayoutList, ArrowUpDown, Sun, Moon, CalendarDays, MessageCircle, Send, Trash2,
  ChevronLeft, ChevronRight, Ban, Languages, RefreshCw, ArrowRightLeft, Calculator,
  ClipboardList, Clock, Wrench, Newspaper, ListChecks, CalendarCheck,
} from "lucide-react";
import logoImg from "@/assets/logo.png";
import { Calendar } from "@/components/ui/calendar";

// ── Types ──────────────────────────────────────────────────────────────────────

type TicketStatus = 'New' | 'In Progress' | 'In Review' | 'Done' | 'Blocked';
type SortField = 'priority' | 'status';
type SortDir = 'asc' | 'desc';
type TranslateDir = 'ko→en' | 'en→ko';
type Page = 'ticket' | 'translate' | 'tools' | 'list' | 'meeting' | 'daily' | 'ideabank' | 'ideas';

interface TicketRecord {
  id: string;
  createdAt: string;
  title: string;
  priority: string;
  ticketType: string;
  status: TicketStatus;
  statusUpdatedAt?: string;
  milestoneDate?: string;
  output: GeneratedOutput;
}

interface CommentEntry {
  id: string;
  text: string;
  section: string;
  createdAt: string;
}

interface GeneratedOutput {
  jiraTicket: string;
  slackStandard: string;
  slackPolished: string;
  slackUrgent: string;
  followUpQuestions: string[];
  pmNotes: string;
  refinementQuestions: string[];
}

interface TranslateResult {
  direct: string;
  natural: string;
  formal: string;
  followUp: string[];
}

type IdeaColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'orange';
type IdeaCategory = 'feature' | 'improvement' | 'research' | 'question' | 'random';

interface IdeaMemo {
  id: string;
  text: string;
  detail: string;
  color: IdeaColor;
  category: IdeaCategory;
  createdAt: string;
  pinned: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4, '?': 5 };
const STATUS_ORDER: Record<string, number> = {
  Blocked: 0, New: 1, 'In Progress': 2, 'In Review': 3, Done: 4,
};
const COMMENT_SECTIONS = ['General', 'Jira Ticket', 'Slack', 'Follow-up', 'PM Notes', 'Refine', 'List', 'Calendar', 'Translate', 'Calculator', 'Meeting'];
const PROGRESS_STAGES: TicketStatus[] = ['New', 'In Progress', 'In Review', 'Done'];
const STAGE_LABELS = ['New', 'In Prog.', 'In Rev.', 'Done'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function parsePriority(jiraTicket: string): string {
  const m = jiraTicket.match(/Priority:\s*(P[1-4])/i);
  return m ? m[1].toUpperCase() : '?';
}

function parseTitle(jiraTicket: string): string {
  const m = jiraTicket.match(/Title:\s*(.+)/);
  return m ? m[1].trim() : 'Untitled';
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to);   b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

async function callClaudeRaw(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.content?.[0]?.text ?? "";
}

async function callOpenAIRaw(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildPrompt(inputText: string, ticketType: string, imageDescriptions: string[]): string {
  const imageContext = imageDescriptions.length > 0
    ? `\n\nAttached images analysis:\n${imageDescriptions.map((d, i) => `Image ${i + 1}: ${d}`).join("\n")}`
    : "";
  const typeLabel = ticketType === "bug" ? "Bug" : "Feature";

  return `You are a PM Workflow Automation Assistant called "Assistant for YJ". Your job is to transform Korean inputs into structured English PM outputs.

INPUT (may be in Korean):
"""
${inputText}${imageContext}
"""

TICKET TYPE: ${typeLabel}

Generate ALL of the following outputs. Return ONLY valid JSON with this exact structure (no markdown fencing):

{
  "jiraTicket": "The full Jira ticket in plain text format using the ${typeLabel} template",
  "slackStandard": "Standard semi-formal Slack message",
  "slackPolished": "Polished / formal Slack message",
  "slackUrgent": "Urgent / action-oriented Slack message",
  "followUpQuestions": ["question1", "question2", "question3", "question4", "question5"],
  "pmNotes": "PM assistant notes covering risk, impact, dependencies, and execution considerations",
  "refinementQuestions": ["deep question 1", "deep question 2", "deep question 3", "deep question 4", "deep question 5"]
}

RULES:
1. ALL outputs must be in English, even if input is Korean.
2. Fill EVERY field - infer/assume where info is missing (Speed Over Accuracy).
3. Jira ticket must use this format:
${ticketType === "bug" ? `Title: [Clear issue summary]

Description:

Issue: [what is broken]
Context: [surrounding context]
Impact: [user/business impact]

Steps to Reproduce:
1. [step]
2. [step]

Expected: [expected behavior]
Actual: [actual behavior]

Platform: [inferred or "Web"]
Environment: [inferred or "Production"]
Release Target: [inferred or "Next Sprint"]

Priority: [P1-P4 with reasoning]`
    : `Title: [Feature summary]

Description:

Objective: [what and why]
User Value: [benefit to users]
Key Function: [core functionality]
Acceptance Criteria:
- [criterion 1]
- [criterion 2]
- [criterion 3]

Platform: [inferred or "All"]
Environment: [inferred or "Production"]
Release Target: [inferred or "Next Sprint"]

Priority: [P1-P4 with reasoning]`}

4. Slack messages should be semi-formal, concise, and reference the ticket summary.
5. Follow-up questions should identify missing or unclear information.
6. PM Notes should think like a PM: risks, dependencies, missing decisions, execution considerations.
7. Refinement questions should be deeper, PM-level questions for iterative improvement.
8. Return ONLY the JSON object, no other text.`;
}

async function callClaude(apiKey: string, prompt: string, imageFiles: File[]): Promise<GeneratedOutput> {
  const contentParts: Array<Record<string, unknown>> = [];
  for (const file of imageFiles) {
    const base64 = await fileToBase64(file);
    contentParts.push({ type: "image", source: { type: "base64", media_type: file.type, data: base64 } });
  }
  contentParts.push({ type: "text", text: prompt });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, messages: [{ role: "user", content: contentParts }] }),
  });

  if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const text = data.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse response as JSON");
  return JSON.parse(jsonMatch[0]) as GeneratedOutput;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Passcode page ──────────────────────────────────────────────────────────────

function PasscodePage({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value === 'odkmedia') {
      localStorage.setItem('drjira-unlocked', 'true');
      onUnlock();
    } else {
      setError(true); setShake(true); setValue('');
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className="min-h-screen notebook-bg flex items-center justify-center p-4">
      <div className={`w-full max-w-sm ${shake ? 'animate-shake' : ''}`}>
        <div className="text-center mb-8">
          <div className="animate-float mb-4">
            <img src={logoImg} alt="logo" className="h-24 mx-auto dark:invert dark:opacity-80" />
          </div>
          <h1 className="text-2xl font-bold">PM Assistant</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter passcode to continue ~</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input type="password" placeholder="Passcode" value={value}
            onChange={(e) => { setValue(e.target.value); setError(false); }}
            className={`text-center text-lg h-12 tracking-widest rounded-xl ${error ? 'border-destructive focus-visible:ring-destructive' : ''}`}
            autoFocus />
          {error && <p className="text-xs text-destructive text-center fade-in">Incorrect passcode. Try again.</p>}
          <Button type="submit" className="w-full h-11 font-semibold rounded-xl" disabled={!value.trim()}>Unlock</Button>
        </form>
      </div>
    </div>
  );
}

// ── Shared components ──────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text); setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 px-2 text-xs">
      {copied ? <Check className="h-3 w-3 mr-1 text-green-600" /> : <Copy className="h-3 w-3 mr-1" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function OutputSection({ title, content }: { title?: string; content: string }) {
  return (
    <div className="relative group">
      <div className="flex items-center justify-between mb-2">
        {title && <h4 className="text-sm font-semibold text-muted-foreground">{title}</h4>}
        <CopyButton text={content} />
      </div>
      <pre className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/50 rounded-lg p-4 font-[inherit]">{content}</pre>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls: Record<string, string> = {
    P1: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
    P2: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800',
    P3: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
    P4: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cls[priority] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {priority}
    </span>
  );
}

// ── Left sidebar nav ───────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Page; label: string; icon: React.ElementType; desc: string; emoji: string }[] = [
  { id: 'daily',      label: 'Daily',             icon: CalendarCheck, desc: 'Schedule, todos, market research', emoji: '🌅' },
  { id: 'ticket',     label: 'Ticket Generator',  icon: Zap,           desc: 'Generate Jira tickets, Slack messages, and PM notes', emoji: '🎫' },
  { id: 'translate',  label: 'Translator',         icon: Languages,     desc: 'Korean ↔ English translation (3 versions)', emoji: '🌏' },
  { id: 'meeting',    label: 'Meeting Notes',      icon: ClipboardList, desc: 'Generate structured meeting notes', emoji: '📝' },
  { id: 'tools',      label: 'Tools',              icon: Wrench,        desc: 'Calculator + Timezone clock', emoji: '🛠️' },
  { id: 'list',       label: 'Ticket List',        icon: LayoutList,    desc: 'View and manage all generated tickets', emoji: '📋' },
  { id: 'ideas',      label: 'Idea Memo',          icon: Zap,           desc: 'Brainstorm and save ideas', emoji: '🧠' },
  { id: 'ideabank',   label: 'Idea Bank',          icon: Zap,           desc: 'Open Idea Bank in new tab', emoji: '💡' },
];

function SideNav({ page, onChangePage }: { page: Page; onChangePage: (p: Page) => void }) {
  return (
    <nav className="w-48 shrink-0 hidden lg:flex flex-col gap-1.5 pt-2">
      {NAV_ITEMS.map((item) => {
        if (item.id === 'ideabank') {
          return (
            <a key={item.id} href="https://ideabank-eight.vercel.app/" target="_blank" rel="noopener noreferrer"
              className="w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5 group text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:scale-[1.02]">
              <span className="text-base shrink-0">{item.emoji}</span>
              <div className="min-w-0">
                <div className="text-xs font-semibold leading-tight">{item.label}</div>
              </div>
            </a>
          );
        }
        const active = page === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChangePage(item.id)}
            className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5 group ${
              active
                ? 'bg-orange-100 dark:bg-orange-900/20 shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:scale-[1.02]'
            }`}
          >
            <span className="text-base shrink-0">{item.emoji}</span>
            <div className="min-w-0">
              <div className={`text-xs font-semibold leading-tight ${active ? 'text-orange-600 dark:text-orange-400' : ''}`}>{item.label}</div>
            </div>
          </button>
        );
      })}
    </nav>
  );
}

function MobileNav({ page, onChangePage }: { page: Page; onChangePage: (p: Page) => void }) {
  return (
    <div className="flex lg:hidden gap-1 mb-4 bg-muted/50 p-1 rounded-xl overflow-x-auto">
      {NAV_ITEMS.map((item) => {
        if (item.id === 'ideabank') {
          return (
            <a key={item.id} href="https://ideabank-eight.vercel.app/" target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap px-2 text-muted-foreground hover:text-foreground">
              <span className="text-sm">{item.emoji}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </a>
          );
        }
        const active = page === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChangePage(item.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap px-2 ${
              active ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="text-sm">{item.emoji}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Calculator page ────────────────────────────────────────────────────────────

function CalculatorPage() {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  const inputDigit = (digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit === '.' ? '0.' : digit);
      setWaitingForOperand(false);
    } else {
      if (digit === '.' && display.includes('.')) return;
      setDisplay(display === '0' && digit !== '.' ? digit : display + digit);
    }
  };

  const calculate = (a: number, b: number, op: string): number => {
    switch (op) {
      case '+': return a + b;
      case '−': return a - b;
      case '×': return a * b;
      case '÷': return b !== 0 ? a / b : 0;
      default: return b;
    }
  };

  const handleOperator = (op: string) => {
    const current = parseFloat(display);
    if (prevValue !== null && !waitingForOperand) {
      const result = calculate(prevValue, current, operator!);
      const rounded = parseFloat(result.toFixed(10));
      setDisplay(String(rounded));
      setPrevValue(rounded);
    } else {
      setPrevValue(current);
    }
    setOperator(op);
    setWaitingForOperand(true);
  };

  const handleEquals = () => {
    const current = parseFloat(display);
    if (prevValue !== null && operator) {
      const result = calculate(prevValue, current, operator);
      const rounded = parseFloat(result.toFixed(10));
      setDisplay(String(rounded));
      setPrevValue(null);
      setOperator(null);
      setWaitingForOperand(true);
    }
  };

  const handleClear = () => {
    setDisplay('0'); setPrevValue(null); setOperator(null); setWaitingForOperand(false);
  };

  const handleToggleSign = () => {
    const val = parseFloat(display);
    if (val !== 0) setDisplay(String(-val));
  };

  const handlePercent = () => {
    setDisplay(String(parseFloat(display) / 100));
    setWaitingForOperand(true);
  };

  const handleBackspace = () => {
    if (waitingForOperand) return;
    if (display.length > 1) setDisplay(display.slice(0, -1));
    else setDisplay('0');
  };

  type CalcBtn = { label: string; action: () => void; variant: 'operator' | 'function' | 'number' | 'equals'; wide?: boolean };

  const rows: CalcBtn[][] = [
    [
      { label: 'C', action: handleClear, variant: 'function' },
      { label: '±', action: handleToggleSign, variant: 'function' },
      { label: '%', action: handlePercent, variant: 'function' },
      { label: '÷', action: () => handleOperator('÷'), variant: 'operator' },
    ],
    [
      { label: '7', action: () => inputDigit('7'), variant: 'number' },
      { label: '8', action: () => inputDigit('8'), variant: 'number' },
      { label: '9', action: () => inputDigit('9'), variant: 'number' },
      { label: '×', action: () => handleOperator('×'), variant: 'operator' },
    ],
    [
      { label: '4', action: () => inputDigit('4'), variant: 'number' },
      { label: '5', action: () => inputDigit('5'), variant: 'number' },
      { label: '6', action: () => inputDigit('6'), variant: 'number' },
      { label: '−', action: () => handleOperator('−'), variant: 'operator' },
    ],
    [
      { label: '1', action: () => inputDigit('1'), variant: 'number' },
      { label: '2', action: () => inputDigit('2'), variant: 'number' },
      { label: '3', action: () => inputDigit('3'), variant: 'number' },
      { label: '+', action: () => handleOperator('+'), variant: 'operator' },
    ],
    [
      { label: '0', action: () => inputDigit('0'), variant: 'number', wide: true },
      { label: '.', action: () => inputDigit('.'), variant: 'number' },
      { label: '=', action: handleEquals, variant: 'equals' },
    ],
  ];

  const variantClass: Record<string, string> = {
    operator: 'bg-primary/15 text-primary hover:bg-primary/25 font-semibold',
    function:  'bg-muted text-muted-foreground hover:bg-muted/70',
    number:    'bg-card border border-border hover:bg-muted/40',
    equals:    'bg-primary text-primary-foreground hover:bg-primary/90 font-semibold',
  };

  return (
    <div className="max-w-xs">
      <div className="mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          Calculator
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">Quick calculations</p>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="bg-muted/50 rounded-xl p-4 text-right min-h-[80px] flex flex-col justify-end">
            {operator && prevValue !== null && (
              <div className="text-xs text-muted-foreground font-mono mb-1">
                {prevValue} {operator}
              </div>
            )}
            <div className="text-4xl font-mono font-semibold tracking-tight truncate">{display}</div>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground" onClick={handleBackspace}>
              ⌫ <span className="text-[10px]">delete</span>
            </Button>
          </div>

          <div className="space-y-2">
            {rows.map((row, ri) => (
              <div key={ri} className="grid grid-cols-4 gap-2">
                {row.map((btn) => (
                  <button
                    key={btn.label}
                    onClick={btn.action}
                    className={`rounded-xl h-14 text-lg font-medium transition-all active:scale-95 ${
                      btn.wide ? 'col-span-2' : ''
                    } ${variantClass[btn.variant]}`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Daily page ────────────────────────────────────────────────────────────────

const HOUR_SLOTS = Array.from({ length: 18 }, (_, i) => i + 6); // 6AM - 11PM
const NEWS_CATEGORIES = [
  { id: 'streaming', label: 'Streaming & OTT' },
  { id: 'adtech', label: 'Ad Tech & Monetization' },
  { id: 'product', label: 'Product & UX' },
  { id: 'ai', label: 'AI & Data' },
  { id: 'market', label: 'Market & Business' },
];

interface DailyTodo {
  id: string;
  text: string;
  done: boolean;
}

interface WeeklyTodo {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  weekKey: string;
}

interface NewsItem {
  title_en: string;
  title_ko: string;
  summary_en: string;
  summary_ko: string;
  source: string;
  followUp: string[];
}

const PST_TZ = 'America/Los_Angeles';

// Returns a Date object whose local fields (getFullYear, getMonth, getDate, getHours, getDay)
// reflect the wall-clock time in PST, regardless of the user's actual timezone.
function nowPST(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PST_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const y = +get('year'), m = +get('month'), d = +get('day');
  const hh = +get('hour') % 24, mm = +get('minute'), ss = +get('second');
  return new Date(y, m - 1, d, hh, mm, ss);
}

function dateToKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function todayKey() {
  const p = nowPST();
  const y = p.getFullYear();
  const m = String(p.getMonth() + 1).padStart(2, '0');
  const d = String(p.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Returns ISO date of Monday of the given week (YYYY-MM-DD), computed in PST if no arg
function weekKey(d?: Date) {
  const base = d ?? nowPST();
  const copy = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const day = copy.getDay(); // 0 Sun..6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  const y = copy.getFullYear();
  const m = String(copy.getMonth() + 1).padStart(2, '0');
  const dd = String(copy.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function WeeklyTodoList() {
  const currentWeek = weekKey();

  const [todos, setTodos] = useState<WeeklyTodo[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('drjira-weekly-todos') ?? '[]') as WeeklyTodo[];
      // Roll over unchecked todos from previous weeks into current week
      const migrated = stored
        .filter((t) => !(t.done && t.weekKey !== currentWeek)) // drop old completed
        .map((t) => (t.weekKey !== currentWeek && !t.done ? { ...t, weekKey: currentWeek } : t));
      if (JSON.stringify(migrated) !== JSON.stringify(stored)) {
        localStorage.setItem('drjira-weekly-todos', JSON.stringify(migrated));
      }
      return migrated;
    } catch { return []; }
  });
  const [newTodo, setNewTodo] = useState('');

  const save = (items: WeeklyTodo[]) => {
    setTodos(items);
    localStorage.setItem('drjira-weekly-todos', JSON.stringify(items));
  };

  const addTodo = () => {
    if (!newTodo.trim()) return;
    save([
      ...todos,
      {
        id: Date.now().toString(),
        text: newTodo.trim(),
        done: false,
        createdAt: new Date().toISOString(),
        weekKey: currentWeek,
      },
    ]);
    setNewTodo('');
  };

  const toggleTodo = (id: string) => save(todos.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  const deleteTodo = (id: string) => save(todos.filter((t) => t.id !== id));

  const doneCount = todos.filter((t) => t.done).length;

  // Week range display (Mon - Sun)
  const weekStart = new Date(currentWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

  const formatCreated = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          Weekly To-Do
          <Badge variant="secondary" className="text-[10px] ml-2">
            {fmt(weekStart)} – {fmt(weekEnd)}
          </Badge>
          {todos.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-auto">{doneCount}/{todos.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Add a weekly task..."
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); }}
            className="h-8 text-xs flex-1"
          />
          <Button size="sm" onClick={addTodo} disabled={!newTodo.trim()} className="h-8 px-3 text-xs shrink-0">
            Add
          </Button>
        </div>

        {todos.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            No tasks this week. Unchecked items roll over automatically~
          </p>
        ) : (
          <ul className="space-y-1">
            {todos.map((todo) => {
              const isRollover = todo.createdAt.split('T')[0] < currentWeek;
              return (
                <li
                  key={todo.id}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
                >
                  <button
                    onClick={() => toggleTodo(todo.id)}
                    className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                      todo.done ? 'bg-primary border-primary' : 'border-border hover:border-primary/50'
                    }`}
                  >
                    {todo.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </button>
                  <span className={`text-xs flex-1 ${todo.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {todo.text}
                  </span>
                  <span
                    className={`text-[10px] font-mono shrink-0 ${isRollover ? 'text-orange-500 dark:text-orange-400' : 'text-muted-foreground'}`}
                    title={isRollover ? `Added ${formatCreated(todo.createdAt)} · rolled over` : `Added ${formatCreated(todo.createdAt)}`}
                  >
                    {isRollover && '↻ '}{formatCreated(todo.createdAt)}
                  </span>
                  <button
                    onClick={() => deleteTodo(todo.id)}
                    className="h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DailySchedule() {
  const [checks, setChecks] = useState<Record<number, string>>(() => {
    try {
      const stored = localStorage.getItem(`daily-schedule-${todayKey()}`);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  const updateSlot = (hour: number, value: string) => {
    setChecks((prev) => {
      const updated = { ...prev, [hour]: value };
      localStorage.setItem(`daily-schedule-${todayKey()}`, JSON.stringify(updated));
      return updated;
    });
  };

  const now = nowPST();
  const currentHour = now.getHours();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Hourly Schedule
          <Badge variant="secondary" className="text-[10px] ml-auto">{todayKey()} PST</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-0 rounded-lg border overflow-hidden">
          {HOUR_SLOTS.map((hour) => {
            const label = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
            const isCurrent = hour === currentHour;
            const isPast = hour < currentHour;
            return (
              <div key={hour} className={`flex items-start gap-3 px-3 py-1.5 border-b last:border-b-0 transition-colors ${
                isCurrent ? 'bg-primary/10 border-l-2 border-l-primary' : isPast ? 'bg-muted/30' : ''
              }`}>
                <span className={`text-xs font-mono w-14 shrink-0 pt-1.5 ${isCurrent ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                  {label}
                </span>
                <textarea
                  placeholder={isCurrent ? '← now' : ''}
                  value={checks[hour] ?? ''}
                  onChange={(e) => updateSlot(hour, e.target.value)}
                  rows={1}
                  ref={(el) => {
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = el.scrollHeight + 'px';
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = el.scrollHeight + 'px';
                  }}
                  className="flex-1 text-xs bg-transparent border-0 outline-none placeholder:text-muted-foreground/40 text-foreground px-1 py-1 resize-none overflow-hidden leading-relaxed"
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DailyTodoList() {
  const [todos, setTodos] = useState<DailyTodo[]>(() => {
    try {
      const stored = localStorage.getItem(`daily-todos-${todayKey()}`);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [newTodo, setNewTodo] = useState('');

  const save = (items: DailyTodo[]) => {
    setTodos(items);
    localStorage.setItem(`daily-todos-${todayKey()}`, JSON.stringify(items));
  };

  const addTodo = () => {
    if (!newTodo.trim()) return;
    save([...todos, { id: Date.now().toString(), text: newTodo.trim(), done: false }]);
    setNewTodo('');
  };

  const toggleTodo = (id: string) => {
    save(todos.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  };

  const deleteTodo = (id: string) => {
    save(todos.filter((t) => t.id !== id));
  };

  const doneCount = todos.filter((t) => t.done).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          Daily To-Do
          {todos.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-auto">{doneCount}/{todos.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="Add a task..." value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); }}
            className="h-8 text-xs flex-1" />
          <Button size="sm" onClick={addTodo} disabled={!newTodo.trim()} className="h-8 px-3 text-xs shrink-0">Add</Button>
        </div>

        {todos.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No tasks yet. Add one above.</p>
        ) : (
          <ul className="space-y-1">
            {todos.map((todo) => (
              <li key={todo.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors">
                <button
                  onClick={() => toggleTodo(todo.id)}
                  className={`h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                    todo.done ? 'bg-primary border-primary' : 'border-border hover:border-primary/50'
                  }`}
                >
                  {todo.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                </button>
                <span className={`text-xs flex-1 ${todo.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {todo.text}
                </span>
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {doneCount > 0 && doneCount === todos.length && (
          <div className="text-center py-2">
            <p className="text-xs text-primary font-medium">All tasks done!</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MarketResearch({ apiKey }: { apiKey: string }) {
  const [category, setCategory] = useState(NEWS_CATEGORIES[0].id);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const fetchNews = useCallback(async (cat: string) => {
    if (!apiKey.trim()) { setError('Set your Claude API key in Settings first.'); return; }

    setLoading(true); setError(null); setNews([]); setExpandedIdx(null);

    const catLabel = NEWS_CATEGORIES.find((c) => c.id === cat)?.label ?? cat;

    const prompt = `You are a market research assistant for a PM working in OTT streaming platforms (like ODKR, Amasian TV). Generate the TOP 10 most recent, non-duplicate, relevant news items for the category: "${catLabel}".

Focus on:
- Technology trends relevant to streaming/OTT
- Product management insights
- Industry moves and market analysis
- Data, AI, and ad-tech developments where relevant

Return ONLY valid JSON (no markdown fencing):

{
  "news": [
    {
      "title_en": "English headline",
      "title_ko": "한국어 제목",
      "summary_en": "2-3 sentence English summary of the article/news",
      "summary_ko": "2-3 문장 한국어 요약",
      "source": "Source name (e.g., TechCrunch, The Verge, etc.)",
      "followUp": ["Follow-up question 1 a PM should consider", "Follow-up question 2", "Follow-up question 3"]
    }
  ]
}

RULES:
1. All 10 items must be unique — no duplicate stories.
2. Focus on news from the past 1-2 weeks (as of today, ${new Date().toISOString().split('T')[0]}).
3. Each item must have both English and Korean versions.
4. Follow-up questions should help a PM think about implications for their OTT platform.
5. Source should be a real, well-known publication.
6. Return ONLY the JSON.`;

    try {
      const raw = await callClaudeRaw(apiKey, prompt);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Failed to parse news data');
      const parsed = JSON.parse(jsonMatch[0]);
      setNews(parsed.news ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch news');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    fetchNews(cat);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-primary" />
          Market Research
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">Top 10 news per category — EN + KO with PM follow-ups</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Category selector */}
        <div className="flex flex-wrap gap-1.5">
          {NEWS_CATEGORIES.map((cat) => (
            <Button key={cat.id} size="sm"
              variant={category === cat.id && news.length > 0 ? 'default' : 'outline'}
              className="h-7 text-[11px] px-2.5"
              onClick={() => handleCategoryChange(cat.id)}
              disabled={loading}
            >
              {cat.label}
            </Button>
          ))}
        </div>

        {!loading && news.length === 0 && !error && (
          <div className="text-center py-8 text-muted-foreground">
            <Newspaper className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">Select a category to load latest news.</p>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Researching {NEWS_CATEGORIES.find((c) => c.id === category)?.label}...</p>
          </div>
        )}

        {error && <div className="bg-destructive/10 text-destructive text-xs rounded-lg p-3">{error}</div>}

        {news.length > 0 && (
          <div className="space-y-2">
            {news.map((item, idx) => {
              const isExpanded = expandedIdx === idx;
              return (
                <div key={idx}
                  className={`rounded-lg border transition-colors ${isExpanded ? 'bg-muted/30 border-primary/30' : 'hover:bg-muted/20'}`}
                >
                  <button
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    className="w-full text-left px-3 py-2.5 flex gap-3 items-start"
                  >
                    <Badge variant="secondary" className="text-[9px] mt-0.5 shrink-0 tabular-nums w-5 justify-center">{idx + 1}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                        <p className="text-xs font-medium leading-snug">{item.title_en}</p>
                        <p className="text-xs text-muted-foreground leading-snug">{item.title_ko}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-1 inline-block">{item.source}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-3 fade-in border-t mx-3 pt-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Summary (EN)</Label>
                          <p className="text-xs leading-relaxed">{item.summary_en}</p>
                        </div>
                        <div>
                          <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">요약 (KO)</Label>
                          <p className="text-xs leading-relaxed text-muted-foreground">{item.summary_ko}</p>
                        </div>
                      </div>

                      {item.followUp && item.followUp.length > 0 && (
                        <div className="bg-primary/5 rounded-lg p-3">
                          <Label className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1.5 block">PM Follow-up Questions</Label>
                          <ul className="space-y-1">
                            {item.followUp.map((q, qi) => (
                              <li key={qi} className="flex gap-1.5 text-xs items-start">
                                <span className="text-primary font-mono text-[10px] mt-0.5 shrink-0">{qi + 1}.</span>
                                <span>{q}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="flex justify-end">
                        <CopyButton text={`${item.title_en}\n${item.title_ko}\n\n${item.summary_en}\n\n${item.summary_ko}\n\nFollow-up:\n${item.followUp?.join('\n') ?? ''}`} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DailyCalendarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => nowPST());

  const dateKey = dateToKey(selectedDate);
  const isToday = dateKey === todayKey();

  const schedule: Record<number, string> = (() => {
    try {
      const stored = localStorage.getItem(`daily-schedule-${dateKey}`);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  })();

  const todos: DailyTodo[] = (() => {
    try {
      const stored = localStorage.getItem(`daily-todos-${dateKey}`);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  })();

  const scheduleEntries = HOUR_SLOTS.filter((h) => schedule[h]?.trim());
  const hasData = scheduleEntries.length > 0 || todos.length > 0;

  // Find dates that have data for dot indicators
  const [datesWithData, setDatesWithData] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    const found = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('daily-schedule-') || key?.startsWith('daily-todos-')) {
        const dateStr = key.replace('daily-schedule-', '').replace('daily-todos-', '');
        try {
          const val = localStorage.getItem(key);
          if (!val) continue;
          const parsed = JSON.parse(val);
          if (key.startsWith('daily-todos-') && Array.isArray(parsed) && parsed.length > 0) {
            found.add(dateStr);
          } else if (key.startsWith('daily-schedule-') && typeof parsed === 'object') {
            if (Object.values(parsed).some((v) => typeof v === 'string' && v.trim())) {
              found.add(dateStr);
            }
          }
        } catch { /* ignore */ }
      }
    }
    setDatesWithData(found);
  }, [open, selectedDate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-background border-l shadow-xl overflow-y-auto fade-in">
        <div className="sticky top-0 bg-background/90 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between z-10">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            Daily Calendar
          </h3>
          <button onClick={onClose} className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Calendar */}
          <div className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => d && setSelectedDate(d)}
              modifiers={{ hasData: (date: Date) => datesWithData.has(dateToKey(date)) }}
              modifiersClassNames={{ hasData: 'ring-2 ring-primary/30 ring-inset' }}
            />
          </div>

          {/* Selected date label */}
          <div className="text-center">
            <Badge variant={isToday ? 'default' : 'secondary'} className="text-xs">
              {isToday ? 'Today' : selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              {' · '}{dateKey}
            </Badge>
          </div>

          {!hasData ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No entries for this day</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Schedule entries */}
              {scheduleEntries.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      Schedule ({scheduleEntries.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {scheduleEntries.map((hour) => {
                      const label = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
                      return (
                        <div key={hour} className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-muted/40 text-xs">
                          <span className="font-mono text-muted-foreground w-12 shrink-0">{label}</span>
                          <span className="text-foreground">{schedule[hour]}</span>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Todo entries */}
              {todos.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs flex items-center gap-2">
                      <ListChecks className="h-3.5 w-3.5 text-primary" />
                      To-Do ({todos.filter((t) => t.done).length}/{todos.length} done)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {todos.map((todo) => (
                      <div key={todo.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/40 text-xs">
                        <span className={`shrink-0 ${todo.done ? 'text-primary' : 'text-muted-foreground'}`}>
                          {todo.done ? '✅' : '⬜'}
                        </span>
                        <span className={todo.done ? 'line-through text-muted-foreground' : 'text-foreground'}>
                          {todo.text}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DailyPage({ apiKey }: { apiKey: string }) {
  const [activeTab, setActiveTab] = useState('schedule');
  const [showCalendar, setShowCalendar] = useState(false);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-primary" />
            Daily
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: PST_TZ })}
            {' · PST'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowCalendar(true)} className="gap-1.5 rounded-xl text-xs">
          <CalendarDays className="h-3.5 w-3.5" />
          Calendar
        </Button>
      </div>

      <WeeklyTodoList />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="schedule" className="gap-1.5 text-xs">
            <Clock className="h-3.5 w-3.5" />Schedule
          </TabsTrigger>
          <TabsTrigger value="todo" className="gap-1.5 text-xs">
            <ListChecks className="h-3.5 w-3.5" />To-Do
          </TabsTrigger>
          <TabsTrigger value="research" className="gap-1.5 text-xs">
            <Newspaper className="h-3.5 w-3.5" />Market Research
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <DailySchedule />
            </div>
            <div>
              <DailyTodoList />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="todo">
          <div className="max-w-lg">
            <DailyTodoList />
          </div>
        </TabsContent>

        <TabsContent value="research">
          <MarketResearch apiKey={apiKey} />
        </TabsContent>
      </Tabs>

      <DailyCalendarDrawer open={showCalendar} onClose={() => setShowCalendar(false)} />
    </div>
  );
}

// ── Timezone clock ─────────────────────────────────────────────────────────────

function TimezoneClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const zones = [
    { label: 'Korea (KST)', tz: 'Asia/Seoul', flag: '🇰🇷' },
    { label: 'US Pacific (PT)', tz: 'America/Los_Angeles', flag: '🇺🇸' },
    { label: 'US Eastern (ET)', tz: 'America/New_York', flag: '🇺🇸' },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          World Clock
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {zones.map((zone) => {
          const time = now.toLocaleTimeString('en-US', { timeZone: zone.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
          const date = now.toLocaleDateString('en-US', { timeZone: zone.tz, weekday: 'short', month: 'short', day: 'numeric' });
          const hour = parseInt(now.toLocaleTimeString('en-US', { timeZone: zone.tz, hour: 'numeric', hour12: false }));
          const isNight = hour < 7 || hour >= 21;
          return (
            <div key={zone.tz} className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
              <div className="flex items-center gap-3">
                <span className="text-xl">{zone.flag}</span>
                <div>
                  <div className="text-xs font-semibold">{zone.label}</div>
                  <div className="text-[10px] text-muted-foreground">{date}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-mono font-semibold tabular-nums">{time}</div>
                <div className="text-[10px] text-muted-foreground">{isNight ? '🌙 Night' : '☀️ Day'}</div>
              </div>
            </div>
          );
        })}
        <div className="text-[10px] text-muted-foreground text-center pt-1">
          KST = UTC+9 • PT = UTC-7 (PDT) • ET = UTC-4 (EDT)
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tools page (Calculator + Timezone) ────────────────────────────────────────

function ToolsPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" />
          Tools
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">Calculator + World Clock</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CalculatorPage />
        <div className="space-y-4">
          <TimezoneClock />
        </div>
      </div>
    </div>
  );
}

// ── Idea Memo page (brainstorming board) ──────────────────────────────────────

const IDEA_COLORS: { id: IdeaColor; label: string; bg: string; border: string; text: string }[] = [
  { id: 'yellow', label: '🟡', bg: 'bg-yellow-100 dark:bg-yellow-900/30', border: 'border-yellow-300 dark:border-yellow-700', text: 'text-yellow-900 dark:text-yellow-100' },
  { id: 'pink',   label: '🩷', bg: 'bg-pink-100 dark:bg-pink-900/30', border: 'border-pink-300 dark:border-pink-700', text: 'text-pink-900 dark:text-pink-100' },
  { id: 'blue',   label: '🔵', bg: 'bg-blue-100 dark:bg-blue-900/30', border: 'border-blue-300 dark:border-blue-700', text: 'text-blue-900 dark:text-blue-100' },
  { id: 'green',  label: '🟢', bg: 'bg-emerald-100 dark:bg-emerald-900/30', border: 'border-emerald-300 dark:border-emerald-700', text: 'text-emerald-900 dark:text-emerald-100' },
  { id: 'purple', label: '🟣', bg: 'bg-purple-100 dark:bg-purple-900/30', border: 'border-purple-300 dark:border-purple-700', text: 'text-purple-900 dark:text-purple-100' },
  { id: 'orange', label: '🟠', bg: 'bg-orange-100 dark:bg-orange-900/30', border: 'border-orange-300 dark:border-orange-700', text: 'text-orange-900 dark:text-orange-100' },
];

const IDEA_CATEGORIES: { id: IdeaCategory; label: string; emoji: string }[] = [
  { id: 'feature',     label: 'Feature',     emoji: '✨' },
  { id: 'improvement', label: 'Improvement', emoji: '🔧' },
  { id: 'research',    label: 'Research',    emoji: '🔍' },
  { id: 'question',    label: 'Question',    emoji: '❓' },
  { id: 'random',      label: 'Random',      emoji: '🎲' },
];

function IdeaMemoPage() {
  const [ideas, setIdeas] = useState<IdeaMemo[]>(() => {
    try { return JSON.parse(localStorage.getItem('drjira-ideas') ?? '[]'); }
    catch { return []; }
  });
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [detail, setDetail] = useState('');
  const [color, setColor] = useState<IdeaColor>('yellow');
  const [category, setCategory] = useState<IdeaCategory>('feature');
  const [filterCat, setFilterCat] = useState<IdeaCategory | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const save = useCallback((items: IdeaMemo[]) => {
    setIdeas(items);
    localStorage.setItem('drjira-ideas', JSON.stringify(items));
  }, []);

  const resetForm = () => {
    setText(''); setDetail(''); setColor('yellow'); setCategory('feature');
    setShowForm(false); setEditId(null);
  };

  const handleSubmit = () => {
    if (!text.trim()) return;
    if (editId) {
      save(ideas.map((i) => i.id === editId ? { ...i, text: text.trim(), detail: detail.trim(), color, category } : i));
    } else {
      const newIdea: IdeaMemo = {
        id: Date.now().toString(), text: text.trim(), detail: detail.trim(),
        color, category, createdAt: new Date().toISOString(), pinned: false,
      };
      save([newIdea, ...ideas]);
    }
    resetForm();
  };

  const handleEdit = (idea: IdeaMemo) => {
    setText(idea.text); setDetail(idea.detail); setColor(idea.color);
    setCategory(idea.category); setEditId(idea.id); setShowForm(true);
  };

  const handleDelete = (id: string) => save(ideas.filter((i) => i.id !== id));
  const handlePin = (id: string) => save(ideas.map((i) => i.id === id ? { ...i, pinned: !i.pinned } : i));

  const filtered = ideas.filter((i) => filterCat === 'all' || i.category === filterCat);
  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const colorOf = (c: IdeaColor) => IDEA_COLORS.find((x) => x.id === c)!;
  const catOf = (c: IdeaCategory) => IDEA_CATEGORIES.find((x) => x.id === c)!;

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            🧠 Idea Memo
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Brainstorm freely — capture, organize, revisit
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true); }} className="gap-1.5 rounded-xl text-xs">
          <Zap className="h-3.5 w-3.5" />
          New Idea
        </Button>
      </div>

      {/* New / Edit form */}
      {showForm && (
        <Card className="mb-6 border-2 border-dashed border-primary/40 fade-in">
          <CardContent className="pt-5 space-y-4">
            <div>
              <Label className="text-xs font-medium mb-1.5 block">{editId ? 'Edit Idea' : 'What\'s your idea?'}</Label>
              <Input
                placeholder="One-liner title for your idea..."
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleSubmit(); }}
                className="h-10 text-sm" autoFocus
              />
            </div>
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Details / Notes (optional)</Label>
              <Textarea
                placeholder="Elaborate, add context, links, thoughts..."
                value={detail} onChange={(e) => setDetail(e.target.value)}
                className="text-sm min-h-[80px]"
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Color</Label>
                <div className="flex gap-1.5">
                  {IDEA_COLORS.map((c) => (
                    <button key={c.id} onClick={() => setColor(c.id)}
                      className={`h-8 w-8 rounded-lg text-sm flex items-center justify-center transition-all ${
                        color === c.id ? 'ring-2 ring-offset-1 ring-foreground/30 scale-110' : 'hover:scale-105'
                      } ${c.bg} ${c.border} border`}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Category</Label>
                <div className="flex gap-1.5 flex-wrap">
                  {IDEA_CATEGORIES.map((cat) => (
                    <button key={cat.id} onClick={() => setCategory(cat.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        category === cat.id
                          ? 'bg-foreground/10 border-foreground/20 ring-1 ring-foreground/10'
                          : 'bg-muted/50 border-transparent hover:bg-muted'
                      }`}>
                      {cat.emoji} {cat.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={resetForm} className="text-xs">Cancel</Button>
              <Button size="sm" onClick={handleSubmit} disabled={!text.trim()} className="text-xs gap-1">
                {editId ? 'Update' : 'Save Idea'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category filter */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        <button onClick={() => setFilterCat('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
            filterCat === 'all' ? 'bg-foreground/10 border-foreground/20' : 'bg-muted/40 border-transparent hover:bg-muted'
          }`}>
          All ({ideas.length})
        </button>
        {IDEA_CATEGORIES.map((cat) => {
          const count = ideas.filter((i) => i.category === cat.id).length;
          return (
            <button key={cat.id} onClick={() => setFilterCat(cat.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                filterCat === cat.id ? 'bg-foreground/10 border-foreground/20' : 'bg-muted/40 border-transparent hover:bg-muted'
              }`}>
              {cat.emoji} {cat.label} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      {/* Idea board */}
      {sorted.length === 0 ? (
        <div className="text-center py-16">
          <span className="text-4xl mb-3 block">🧠</span>
          <p className="text-sm text-muted-foreground">No ideas yet. Tap "New Idea" to start brainstorming!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((idea) => {
            const c = colorOf(idea.color);
            const cat = catOf(idea.category);
            const expanded = expandedId === idea.id;
            const date = new Date(idea.createdAt);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            return (
              <div key={idea.id}
                className={`group relative rounded-2xl border-2 p-4 transition-all hover:shadow-lg hover:-translate-y-0.5 cursor-pointer ${c.bg} ${c.border} ${c.text} ${
                  idea.pinned ? 'ring-2 ring-orange-400/50' : ''
                }`}
                onClick={() => setExpandedId(expanded ? null : idea.id)}
              >
                {/* Pin indicator */}
                {idea.pinned && (
                  <span className="absolute -top-2 -right-2 text-lg">📌</span>
                )}

                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10">
                    {cat.emoji} {cat.label}
                  </span>
                  <span className="text-[10px] opacity-60 shrink-0">{dateStr}</span>
                </div>

                {/* Title */}
                <h3 className="font-semibold text-sm leading-snug mb-1">{idea.text}</h3>

                {/* Detail preview */}
                {idea.detail && !expanded && (
                  <p className="text-xs opacity-70 line-clamp-2 leading-relaxed">{idea.detail}</p>
                )}

                {/* Expanded detail */}
                {expanded && (
                  <div className="fade-in mt-2">
                    {idea.detail && (
                      <p className="text-xs opacity-80 leading-relaxed whitespace-pre-wrap mb-3">{idea.detail}</p>
                    )}
                    <div className="flex gap-1.5 pt-2 border-t border-black/10 dark:border-white/10">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); handleEdit(idea); }}>
                        ✏️ Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); handlePin(idea.id); }}>
                        {idea.pinned ? '📌 Unpin' : '📌 Pin'}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(idea.id); }}>
                        🗑️ Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Translate page (3 versions + follow-up) ───────────────────────────────────

function TranslatePage({ apiKey, openaiKey }: { apiKey: string; openaiKey: string }) {
  const [inputText, setInputText] = useState('');
  const [direction, setDirection] = useState<TranslateDir>('ko→en');
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = useCallback(async () => {
    if (!inputText.trim()) return;
    if (!apiKey.trim() && !openaiKey.trim()) {
      setError('Set a Claude or OpenAI API key in Settings first.');
      return;
    }

    setLoading(true); setError(null); setResult(null);
    const [from, to] = direction === 'ko→en' ? ['Korean', 'English'] : ['English', 'Korean'];

    const prompt = `You are a PM-focused translator. Translate the following text from ${from} to ${to} in THREE different styles. Also, think like a PM: if someone is communicating this content, what additional context or follow-up points would they also want to mention?

Return ONLY valid JSON (no markdown fencing):

{
  "direct": "Direct/literal translation — accurate, close to original wording",
  "natural": "Natural/conversational — sounds fluent and natural in ${to}, slightly rephrased for clarity",
  "formal": "Polished/professional — formal business tone, suitable for executive communication or official documents",
  "followUp": ["As a PM communicating this, you should also consider mentioning...", "Additional context worth sharing...", "Related point that stakeholders would want to know..."]
}

RULES:
1. All three versions must convey the same meaning but differ in tone/style.
2. Follow-up suggestions (3-5 items) should be things a PM would naturally add when sharing this content — context, caveats, related action items, stakeholder considerations.
3. Return ONLY the JSON.

Text to translate:
"""
${inputText}
"""`;

    try {
      const raw = openaiKey.trim()
        ? await callOpenAIRaw(openaiKey, prompt)
        : await callClaudeRaw(apiKey, prompt);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Failed to parse translation result');
      setResult(JSON.parse(jsonMatch[0]) as TranslateResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      setLoading(false);
    }
  }, [inputText, direction, apiKey, openaiKey]);

  const swapDirection = useCallback(() => {
    setDirection((d) => d === 'ko→en' ? 'en→ko' : 'ko→en');
    if (result) { setInputText(result.natural); setResult(null); }
  }, [result]);

  const versionLabels = [
    { key: 'direct' as const, label: 'Direct / Literal', desc: 'Close to original wording' },
    { key: 'natural' as const, label: 'Natural', desc: 'Fluent and conversational' },
    { key: 'formal' as const, label: 'Polished / Formal', desc: 'Professional business tone' },
  ];

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Languages className="h-5 w-5 text-primary" />
          Translator
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">Korean ↔ English — 3 versions + PM follow-up suggestions</p>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-4">
          {/* Direction bar */}
          <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
            <span className={`text-sm font-semibold ${direction === 'ko→en' ? 'text-foreground' : 'text-muted-foreground'}`}>한국어</span>
            <Button variant="outline" size="sm" className="h-7 px-2 gap-1" onClick={swapDirection}>
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span className="text-xs">Swap</span>
            </Button>
            <span className={`text-sm font-semibold ${direction === 'en→ko' ? 'text-foreground' : 'text-muted-foreground'}`}>English</span>
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {direction === 'ko→en' ? 'KO → EN' : 'EN → KO'}
            </Badge>
          </div>

          {/* Input */}
          <div>
            <Label className="text-xs font-medium mb-1.5 block text-muted-foreground">
              {direction === 'ko→en' ? 'Korean input' : 'English input'}
            </Label>
            <Textarea
              placeholder={direction === 'ko→en'
                ? '번역할 한국어 텍스트를 입력하세요...'
                : 'Enter English text to translate...'}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="min-h-[140px] text-sm resize-y"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleTranslate(); }}
            />
            <p className="text-[10px] text-muted-foreground mt-1">⌘+Enter to translate</p>
          </div>

          <Button onClick={handleTranslate} disabled={loading || !inputText.trim()} className="w-full h-10 font-semibold gap-2">
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Translating (3 versions)...</>
              : <><Languages className="h-4 w-4" />Translate</>}
          </Button>

          {error && <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">{error}</div>}
        </CardContent>
      </Card>

      {result && (
        <div className="mt-4 space-y-4 fade-in">
          {/* 3 translation versions */}
          {versionLabels.map(({ key, label, desc }) => (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <div>
                    <span>{label}</span>
                    <span className="text-[10px] text-muted-foreground font-normal ml-2">{desc}</span>
                  </div>
                  <div className="flex gap-1">
                    <CopyButton text={result[key]} />
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => { setInputText(result[key]); setResult(null); swapDirection(); }}>
                      <RefreshCw className="h-3 w-3" />Use as input
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/50 rounded-lg p-4 font-[inherit]">{result[key]}</pre>
              </CardContent>
            </Card>
          ))}

          {/* Follow-up suggestions */}
          {result.followUp && result.followUp.length > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-primary" />
                  PM Follow-up Suggestions
                  <span className="text-[10px] text-muted-foreground font-normal">Things you might also want to communicate</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.followUp.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm items-start">
                      <Badge variant="secondary" className="text-[10px] mt-0.5 shrink-0 bg-primary/15 text-primary border-0">{i + 1}</Badge>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ── Meeting Notes page ─────────────────────────────────────────────────────────

function MeetingNotesPage({ apiKey }: { apiKey: string }) {
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [rawNotes, setRawNotes] = useState('');
  const [knownActionItems, setKnownActionItems] = useState('');
  const [attendees, setAttendees] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!rawNotes.trim()) return;
    if (!apiKey.trim()) { setError('Set your Claude API key in Settings first.'); return; }

    setLoading(true); setError(null); setResult('');

    const prompt = `You are a PM assistant that creates structured meeting notes. Generate professional, structured meeting notes in the EXACT format shown below.

MEETING INFO:
- Title: ${meetingTitle || 'Weekly Meeting'}
- Date: ${meetingDate}
- Attendees: ${attendees || '(not specified)'}

RAW MEETING NOTES / CONTENT (may be in Korean or English):
"""
${rawNotes}
"""

${knownActionItems.trim() ? `KNOWN ACTION ITEMS (from user):
"""
${knownActionItems}
"""` : 'No specific action items provided — extract them from the notes.'}

Generate meeting notes in this EXACT structure (use plain text, no markdown fencing):

═══════════════════════════════════════════
${meetingTitle || 'Meeting Notes'} (${meetingDate})
═══════════════════════════════════════════

Action Items
┌────────────────────────┬──────────────┬──────────────┬────────────────────┬────────────┬──────────────┐
│ Task                   │ Owner        │ Reporting to │ Deliverables       │ Due Date   │ Remark       │
├────────────────────────┼──────────────┼──────────────┼────────────────────┼────────────┼──────────────┤
│ [extracted task]       │ @[person]    │ @[person]    │ [deliverable]      │ [date]     │ [remarks]    │
└────────────────────────┴──────────────┴──────────────┴────────────────────┴────────────┴──────────────┘

───────────────────────────────────────────
KO (한국어)
───────────────────────────────────────────

[Organize the meeting content by topic in Korean. Each topic should have:]
1. [Topic Name]
   a. Current Progress
      i. [detail]
   b. Action Items (if any, with owner and due date)

[Continue for all topics discussed...]

───────────────────────────────────────────
EN (English)
───────────────────────────────────────────

[Same content translated into English, organized identically by topic.]
1. [Topic Name]
   a. Current Progress
      i. [detail]
   b. Action Items (if any, with owner and due date)

[Continue for all topics discussed...]

RULES:
1. Extract ALL action items from the notes and list them in the Action Items table.
2. If information is missing (owner, due date, etc.), infer reasonable values or mark as TBD.
3. Organize content by discussion topics, not chronologically.
4. KO section should be in Korean. EN section should be in English.
5. If input is all in one language, still produce both KO and EN sections.
6. Keep the formatting clean and professional.
7. Return ONLY the formatted meeting notes, no extra commentary.`;

    try {
      setResult((await callClaudeRaw(apiKey, prompt)).trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }, [rawNotes, meetingTitle, meetingDate, attendees, knownActionItems, apiKey]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          Meeting Notes Generator
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">Paste raw meeting content → structured bilingual notes (KO + EN)</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />Meeting Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Meeting Title</Label>
                  <Input placeholder="e.g., ENG Weekly Meeting" value={meetingTitle}
                    onChange={(e) => setMeetingTitle(e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Date</Label>
                  <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)}
                    className="w-full text-sm border border-border rounded-md px-3 py-1.5 h-9 bg-transparent text-foreground" />
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium mb-1.5 block">
                  Attendees <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input placeholder="e.g., @Peter, @Sean, @Seongtaek" value={attendees}
                  onChange={(e) => setAttendees(e.target.value)} className="h-9 text-sm" />
              </div>

              <div>
                <Label className="text-xs font-medium mb-1.5 block">
                  Raw Meeting Notes <span className="text-destructive">*</span>
                  <span className="text-muted-foreground ml-1">(paste content, Korean or English)</span>
                </Label>
                <Textarea placeholder={"미팅 내용을 붙여넣으세요...\n\n예:\n- User Account: Apple Sign-In 진행 상황 공유\n- Data Migration: Luigi → Airflow 전환 90% 완료\n- 액션 아이템: @Sean ID Graph Study (4/8까지)"}
                  value={rawNotes} onChange={(e) => setRawNotes(e.target.value)}
                  className="min-h-[200px] text-sm resize-y" />
              </div>

              <div>
                <Label className="text-xs font-medium mb-1.5 block">
                  Known Action Items <span className="text-muted-foreground">(optional — auto-extracts from notes if empty)</span>
                </Label>
                <Textarea placeholder={"알고 있는 액션 아이템을 입력하세요...\n\n예:\n- @Sean: Collection Module 정의 (Apr 1)\n- @Seongtaek: 샘플 로그 데이터 공유 (Apr 1)"}
                  value={knownActionItems} onChange={(e) => setKnownActionItems(e.target.value)}
                  className="min-h-[100px] text-sm resize-y" />
              </div>

              <Separator />
              <Button onClick={handleGenerate} disabled={loading || !rawNotes.trim()} className="w-full h-10 font-semibold gap-2">
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Generating meeting notes...</>
                  : <><ClipboardList className="h-4 w-4" />Generate Meeting Notes</>}
              </Button>
              {error && <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3">{error}</div>}
            </CardContent>
          </Card>
        </div>

        {/* Output */}
        <div>
          {!result && !loading && (
            <div className="flex flex-col items-center justify-center h-[400px] text-center text-muted-foreground">
              <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4"><ClipboardList className="h-8 w-8" /></div>
              <h3 className="font-semibold text-foreground mb-1">Ready to generate</h3>
              <p className="text-sm max-w-xs">Paste your raw meeting notes and click Generate.</p>
              <p className="text-xs mt-3 text-muted-foreground max-w-xs">Output: Action Items table + KO notes + EN notes — same format as your ENG Weekly Meeting Notes.</p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-[400px] text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
              <h3 className="font-semibold mb-1">Generating meeting notes...</h3>
              <p className="text-sm text-muted-foreground">Structuring content, extracting action items, translating</p>
            </div>
          )}

          {result && !loading && (
            <Card className="fade-in">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Generated Meeting Notes</span>
                  <CopyButton text={result} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-muted/50 rounded-lg p-4 font-mono max-h-[600px] overflow-y-auto">{result}</pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Jira Ticket Editor (editable fields + Send to Jira) ───────────────────────

const JIRA_PROJECTS = [
  { key: 'AMW', name: 'Amasian Web' },
  { key: 'AMS', name: 'Amasian TV' },
  { key: 'AMA', name: 'Amasian-Android' },
  { key: 'AMI', name: 'Amasian-iOS' },
  { key: 'AMR', name: 'Amasian Roku' },
  { key: 'AMT', name: 'Amasian-tvOS' },
  { key: 'AMY', name: 'Amasian YD' },
  { key: 'BILL', name: 'Billing' },
  { key: 'BE', name: 'Back-End Team' },
  { key: 'CMS', name: 'CMS Team' },
  { key: 'BUG', name: 'ODK Market Issue' },
  { key: 'ASM', name: 'All Scrum Management' },
];

const JIRA_ISSUE_TYPES = ['Bug', 'Task', 'Feature', 'Story', 'Epic', 'Improvement', 'Sub-task'];
const JIRA_PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

interface JiraFields {
  project: string;
  issueType: string;
  summary: string;
  description: string;
  priority: string;
  labels: string;
}

function parseJiraFields(ticketText: string, ticketType: string): JiraFields {
  // Extract title from the ticket text
  const titleMatch = ticketText.match(/(?:Title|Summary)[:\s]*(.+)/i);
  const summary = titleMatch ? titleMatch[1].trim() : ticketText.split('\n')[0].trim();

  // Extract priority
  const prioMatch = ticketText.match(/P[1-4]/);
  const prioMap: Record<string, string> = { P1: 'Highest', P2: 'High', P3: 'Medium', P4: 'Low' };
  const priority = prioMatch ? (prioMap[prioMatch[0]] ?? 'Medium') : 'Medium';

  // Issue type from ticket type
  const issueType = ticketType === 'bug' ? 'Bug' : 'Task';

  return {
    project: 'AMW',
    issueType,
    summary,
    description: ticketText,
    priority,
    labels: '',
  };
}

function JiraTicketEditor({
  ticketText, ticketType, onUpdateTicket, onSendToJira,
}: {
  ticketText: string;
  ticketType: string;
  onUpdateTicket: (text: string) => void;
  onSendToJira: (fields: JiraFields) => void;
}) {
  const [fields, setFields] = useState<JiraFields>(() => parseJiraFields(ticketText, ticketType));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Sync description when ticket text changes externally (e.g. from revision)
  useEffect(() => {
    setFields((prev) => ({ ...prev, description: ticketText }));
  }, [ticketText]);

  const updateField = <K extends keyof JiraFields>(key: K, val: JiraFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: val }));
    setSent(false);
  };

  const handleSend = async () => {
    setSending(true);
    // Save to localStorage for MCP pickup
    const payload = { ...fields, timestamp: new Date().toISOString(), status: 'pending' };
    localStorage.setItem('drjira-send-to-jira', JSON.stringify(payload));
    onSendToJira(fields);
    setSending(false);
    setSent(true);
  };

  return (
    <div className="space-y-4">
      {/* Jira fields */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Jira Fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Project *</Label>
              <Select value={fields.project} onValueChange={(v) => updateField('project', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JIRA_PROJECTS.map((p) => (
                    <SelectItem key={p.key} value={p.key} className="text-xs">{p.key} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Issue Type *</Label>
              <Select value={fields.issueType} onValueChange={(v) => updateField('issueType', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JIRA_ISSUE_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Priority *</Label>
              <Select value={fields.priority} onValueChange={(v) => updateField('priority', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JIRA_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Labels</Label>
              <Input value={fields.labels} onChange={(e) => updateField('labels', e.target.value)}
                placeholder="comma-separated" className="h-8 text-xs" />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1 block">Summary *</Label>
            <Input value={fields.summary} onChange={(e) => updateField('summary', e.target.value)}
              className="h-8 text-xs" />
          </div>
        </CardContent>
      </Card>

      {/* Editable description */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Description
            <CopyButton text={fields.description} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={fields.description}
            onChange={(e) => { updateField('description', e.target.value); onUpdateTicket(e.target.value); }}
            className="text-sm leading-relaxed font-[inherit] min-h-[300px]"
          />
        </CardContent>
      </Card>

      {/* Send button */}
      <Button onClick={handleSend} disabled={sending || !fields.summary.trim()}
        className="w-full h-10 gap-2 font-semibold">
        {sending
          ? <><Loader2 className="h-4 w-4 animate-spin" />Sending to Jira...</>
          : sent
            ? <><Check className="h-4 w-4" />Ready — ask Claude to send!</>
            : <><Send className="h-4 w-4" />Send to Jira</>}
      </Button>
      {sent && (
        <p className="text-xs text-center text-muted-foreground fade-in">
          Ticket data saved. Tell Claude: "send this to Jira" to create the issue.
        </p>
      )}
    </div>
  );
}

// ── Follow-up tab with Jira revision ──────────────────────────────────────────

function FollowUpTab({
  questions, jiraTicket, apiKey, onReviseTicket,
}: {
  questions: string[];
  jiraTicket: string;
  apiKey: string;
  onReviseTicket: (revised: string) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''));
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revised, setRevised] = useState(false);

  const setAnswer = (i: number, val: string) => {
    setAnswers((prev) => { const next = [...prev]; next[i] = val; return next; });
    setRevised(false);
  };

  const filledCount = answers.filter((a) => a.trim()).length;

  const handleRevise = async () => {
    if (!apiKey.trim()) { setError('Set your Claude API key in Settings first.'); return; }
    if (filledCount === 0) { setError('Answer at least one question before revising.'); return; }

    setRevising(true); setError(null);
    const qaBlock = questions
      .map((q, i) => answers[i].trim() ? `Q: ${q}\nA: ${answers[i].trim()}` : null)
      .filter(Boolean).join('\n\n');

    const prompt = `You are a Jira PM assistant. Revise the Jira ticket below by incorporating the new information from the Q&A answers. Keep the same format and structure. Return ONLY the revised ticket text, no commentary, no markdown fencing.

ORIGINAL TICKET:
"""
${jiraTicket}
"""

FOLLOW-UP Q&A:
"""
${qaBlock}
"""`;

    try {
      onReviseTicket((await callClaudeRaw(apiKey, prompt)).trim());
      setRevised(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Revision failed');
    } finally {
      setRevising(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          Follow-up Questions
          {filledCount > 0 && <Badge variant="secondary" className="text-[10px]">{filledCount} answered</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-4">
          {questions.map((q, i) => (
            <li key={i} className="space-y-2">
              <div className="flex gap-2 items-start">
                <Badge variant="secondary" className="text-[10px] mt-0.5 shrink-0">Q{i + 1}</Badge>
                <span className="text-sm">{q}</span>
              </div>
              <Textarea placeholder="Your answer…" value={answers[i]}
                onChange={(e) => setAnswer(i, e.target.value)}
                className="min-h-[60px] text-xs resize-y ml-6" />
            </li>
          ))}
        </ul>
        <Separator />
        <div className="space-y-2">
          <Button onClick={handleRevise} disabled={revising || filledCount === 0} className="w-full h-9 gap-2 font-semibold">
            {revising
              ? <><Loader2 className="h-4 w-4 animate-spin" />Revising ticket...</>
              : <><RefreshCw className="h-4 w-4" />Revise Jira Ticket with Answers</>}
          </Button>
          {revised && (
            <p className="text-xs text-green-600 dark:text-green-400 text-center fade-in">
              ✓ Jira ticket updated — check the Jira Ticket tab
            </p>
          )}
          {error && <div className="bg-destructive/10 text-destructive text-xs rounded-lg p-3">{error}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Project hover card ─────────────────────────────────────────────────────────

function ProjectHoverCard({ record, onView }: { record: TicketRecord; onView: (r: TicketRecord) => void }) {
  const isBlocked = record.status === 'Blocked';
  const activeIndex = isBlocked ? -1 : PROGRESS_STAGES.indexOf(record.status as TicketStatus);
  const today = new Date();
  const milestoneDaysUntil = record.milestoneDate ? daysBetween(today, new Date(record.milestoneDate + 'T00:00:00')) : null;
  const daysSinceUpdate = daysBetween(new Date(record.statusUpdatedAt ?? record.createdAt), today);

  return (
    <div className="p-3 space-y-3">
      <div>
        <p className="text-xs font-semibold leading-snug">{record.title}</p>
        <div className="flex items-center gap-1 mt-1.5">
          <PriorityBadge priority={record.priority} />
          <Badge variant="secondary" className="text-[9px]">{record.ticketType === 'bug' ? 'Bug' : 'Feature'}</Badge>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Progress</p>
        {isBlocked ? (
          <div className="flex items-center gap-1.5 text-xs text-destructive font-medium">
            <Ban className="h-3.5 w-3.5" />Blocked — needs attention
          </div>
        ) : (
          <div className="flex items-center">
            {PROGRESS_STAGES.map((stage, i) => {
              const isDone = i <= activeIndex;
              const isCurrent = i === activeIndex;
              return (
                <Fragment key={stage}>
                  <div className="flex flex-col items-center" style={{ minWidth: '46px' }}>
                    <div className={`h-2.5 w-2.5 rounded-full border-2 transition-colors ${
                      isCurrent ? 'bg-primary border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.2)]'
                        : isDone ? 'bg-primary/50 border-primary/50' : 'bg-background border-border'
                    }`} />
                    <span className={`text-[8px] text-center mt-0.5 leading-tight ${
                      isCurrent ? 'text-primary font-semibold' : isDone ? 'text-primary/70' : 'text-muted-foreground'
                    }`}>{STAGE_LABELS[i]}</span>
                  </div>
                  {i < PROGRESS_STAGES.length - 1 && (
                    <div className={`h-0.5 flex-1 mb-3.5 transition-colors ${i < activeIndex ? 'bg-primary/50' : 'bg-border'}`} />
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-1 text-[10px] border-t pt-2">
        <div className="flex justify-between text-muted-foreground">
          <span>Created</span>
          <span>{new Date(record.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
        {daysSinceUpdate > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Last update</span>
            <span className={daysSinceUpdate >= 2 ? 'text-yellow-500 font-medium' : ''}>{daysSinceUpdate}d ago</span>
          </div>
        )}
        {record.milestoneDate && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Milestone</span>
            <span className={milestoneDaysUntil !== null && milestoneDaysUntil < 0 ? 'text-destructive font-medium'
              : milestoneDaysUntil !== null && milestoneDaysUntil <= 3 ? 'text-orange-500 font-medium' : 'text-muted-foreground'}>
              {record.milestoneDate}
              {milestoneDaysUntil !== null && milestoneDaysUntil < 0 ? ` (${Math.abs(milestoneDaysUntil)}d overdue)`
                : milestoneDaysUntil === 0 ? ' (today)'
                : milestoneDaysUntil !== null && milestoneDaysUntil <= 3 ? ` (${milestoneDaysUntil}d left)` : ''}
            </span>
          </div>
        )}
      </div>

      <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5" onClick={() => onView(record)}>
        <FileText className="h-3 w-3" />View Jira Ticket
      </Button>
    </div>
  );
}

// ── Summary tab (with delete) ─────────────────────────────────────────────────

function SummaryTab({
  history, sortField, sortDir, onSort, onStatusChange, onMilestoneDateChange, onView, onDelete,
}: {
  history: TicketRecord[];
  sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void;
  onStatusChange: (id: string, status: TicketStatus) => void;
  onMilestoneDateChange: (id: string, date: string) => void;
  onView: (record: TicketRecord) => void;
  onDelete: (id: string) => void;
}) {
  const sorted = [...history].sort((a, b) => {
    const cmp = sortField === 'priority'
      ? (PRIORITY_ORDER[a.priority] ?? 5) - (PRIORITY_ORDER[b.priority] ?? 5)
      : (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (history.length === 0) {
    return <div className="text-center text-muted-foreground text-sm py-12">No tickets generated yet.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort by:</span>
        {(['priority', 'status'] as SortField[]).map((f) => (
          <Button key={f} variant={sortField === f ? 'default' : 'outline'} size="sm"
            className="h-7 text-xs capitalize gap-1" onClick={() => onSort(f)}>
            <ArrowUpDown className="h-3 w-3" />{f}
            {sortField === f && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Title</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-16">Type</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-16">Priority</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-32">Status</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-36">Milestone</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((record) => (
              <tr key={record.id} className="border-t hover:bg-muted/20 transition-colors group">
                <td className="px-3 py-2 text-xs max-w-0">
                  <HoverCard openDelay={250} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <span className="block truncate cursor-default hover:text-primary transition-colors">{record.title}</span>
                    </HoverCardTrigger>
                    <HoverCardContent className="p-0 w-64" side="right" align="start">
                      <ProjectHoverCard record={record} onView={onView} />
                    </HoverCardContent>
                  </HoverCard>
                </td>
                <td className="px-3 py-2">
                  <Badge variant="secondary" className="text-[10px]">{record.ticketType === 'bug' ? 'Bug' : 'Feature'}</Badge>
                </td>
                <td className="px-3 py-2"><PriorityBadge priority={record.priority} /></td>
                <td className="px-3 py-2">
                  <Select value={record.status} onValueChange={(v) => onStatusChange(record.id, v as TicketStatus)}>
                    <SelectTrigger className="h-6 text-xs w-28 px-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['New', 'In Progress', 'In Review', 'Done', 'Blocked'] as TicketStatus[]).map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <input type="date" value={record.milestoneDate ?? ''}
                    onChange={(e) => onMilestoneDateChange(record.id, e.target.value)}
                    className="text-xs border border-border rounded px-1.5 py-0.5 h-6 bg-transparent text-foreground w-32" />
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center gap-0.5 justify-end">
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onView(record)}>View</Button>
                    <Button variant="ghost" size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(record.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Calendar tab ───────────────────────────────────────────────────────────────

function CalendarTab({ history }: { history: TicketRecord[] }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const prevMonth = () => { const d = new Date(viewYear, viewMonth - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); };
  const nextMonth = () => { const d = new Date(viewYear, viewMonth + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); };

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const todayStr = today.toISOString().split('T')[0];
  const milestoneMap: Record<string, TicketRecord[]> = {};
  history.forEach((r) => {
    if (r.milestoneDate) { if (!milestoneMap[r.milestoneDate]) milestoneMap[r.milestoneDate] = []; milestoneMap[r.milestoneDate].push(r); }
  });
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  const milestonesThisMonth = history.filter((r) => r.milestoneDate?.startsWith(monthPrefix)).sort((a, b) => (a.milestoneDate ?? '').localeCompare(b.milestoneDate ?? ''));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <CardTitle className="text-sm">{monthLabel}</CardTitle>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-7">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <div key={i} className="min-h-[52px]" />;
            const dateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`;
            const tickets = milestoneMap[dateStr] ?? [];
            const isToday = dateStr === todayStr;
            return (
              <div key={i} className={`min-h-[52px] rounded-md p-1 border transition-colors ${isToday ? 'border-primary bg-primary/5' : tickets.length > 0 ? 'border-border bg-muted/20' : 'border-border hover:bg-muted/20'}`}>
                <div className={`text-[11px] font-medium mb-0.5 ${isToday ? 'text-primary' : 'text-foreground'}`}>{day}</div>
                {tickets.slice(0, 2).map((t) => <div key={t.id} className="text-[9px] leading-tight bg-primary/15 text-primary rounded px-1 py-0.5 mb-0.5 truncate" title={t.title}>{t.title}</div>)}
                {tickets.length > 2 && <div className="text-[9px] text-muted-foreground">+{tickets.length - 2}</div>}
              </div>
            );
          })}
        </div>
        {milestonesThisMonth.length > 0 ? (
          <div className="space-y-2 pt-2 border-t">
            <h4 className="text-xs font-semibold text-muted-foreground">Milestones this month</h4>
            {milestonesThisMonth.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-20 shrink-0 font-mono">{r.milestoneDate}</span>
                <PriorityBadge priority={r.priority} />
                <Badge variant="secondary" className="text-[9px] shrink-0">{r.ticketType === 'bug' ? 'Bug' : 'Feature'}</Badge>
                <span className="truncate text-foreground">{r.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-2">No milestones this month. Set dates in the List tab.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── List page ─────────────────────────────────────────────────────────────────

function ListPage({
  history, sortField, sortDir, onSort, onStatusChange, onMilestoneDateChange, onDelete,
}: {
  history: TicketRecord[];
  sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void;
  onStatusChange: (id: string, status: TicketStatus) => void;
  onMilestoneDateChange: (id: string, date: string) => void;
  onDelete: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState('summary');
  const [viewRecord, setViewRecord] = useState<TicketRecord | null>(null);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <LayoutList className="h-5 w-5 text-primary" />
          Ticket List
          {history.length > 0 && (
            <Badge variant="secondary" className="text-xs">{history.length}</Badge>
          )}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">Manage and track all generated tickets</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="summary" className="gap-1.5 text-xs">
            <LayoutList className="h-3.5 w-3.5" />List
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5 text-xs">
            <CalendarDays className="h-3.5 w-3.5" />Calendar
          </TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          <SummaryTab
            history={history}
            sortField={sortField}
            sortDir={sortDir}
            onSort={onSort}
            onStatusChange={onStatusChange}
            onMilestoneDateChange={onMilestoneDateChange}
            onView={setViewRecord}
            onDelete={onDelete}
          />
        </TabsContent>
        <TabsContent value="calendar">
          <CalendarTab history={history} />
        </TabsContent>
      </Tabs>

      {viewRecord && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setViewRecord(null)}
        >
          <div
            className="bg-background rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <PriorityBadge priority={viewRecord.priority} />
                <span className="text-sm font-semibold truncate">{viewRecord.title}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <CopyButton text={viewRecord.output.jiraTicket} />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setViewRecord(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="overflow-y-auto p-5">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/50 rounded-lg p-4 font-[inherit]">
                {viewRecord.output.jiraTicket}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Comment drawer ─────────────────────────────────────────────────────────────

function CommentDrawer({ open, onClose, comments, onAdd, onDelete }: {
  open: boolean; onClose: () => void;
  comments: CommentEntry[];
  onAdd: (text: string, section: string) => void;
  onDelete: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [section, setSection] = useState('General');
  const handleSubmit = () => { if (!text.trim()) return; onAdd(text.trim(), section); setText(''); };
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-background border-l shadow-xl flex flex-col fade-in">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            Comments
            {comments.length > 0 && <Badge variant="secondary" className="text-[10px]">{comments.length}</Badge>}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0"><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {comments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No comments yet.</p>
          ) : comments.map((c) => (
            <div key={c.id} className="group rounded-lg bg-muted/50 p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-[9px] shrink-0">{c.section}</Badge>
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-muted-foreground text-[9px]">{new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive" onClick={() => onDelete(c.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <p className="text-foreground whitespace-pre-wrap leading-relaxed">{c.text}</p>
            </div>
          ))}
        </div>
        <div className="border-t p-3 space-y-2 bg-muted/20">
          <Select value={section} onValueChange={setSection}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{COMMENT_SECTIONS.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-2 items-end">
            <Textarea placeholder="Write a comment… (⌘+Enter)" value={text} onChange={(e) => setText(e.target.value)}
              className="text-xs min-h-[60px] resize-none flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }} />
            <Button size="sm" className="shrink-0 h-9 w-9 p-0" onClick={handleSubmit} disabled={!text.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Ticket Generator page ──────────────────────────────────────────────────────

function TicketGeneratorPage({
  apiKey, showSettings, setShowSettings, history, onAddRecord, onUpdateRecord,
}: {
  apiKey: string;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  history: TicketRecord[];
  onAddRecord: (record: TicketRecord) => void;
  onUpdateRecord: (id: string, updates: Partial<TicketRecord>) => void;
}) {
  const [inputText, setInputText] = useState("");
  const [ticketType, setTicketType] = useState("bug");
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [autoDetectType, setAutoDetectType] = useState(true);

  const [output, setOutput] = useState<GeneratedOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('jira');
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const validFiles = files.filter((f) => f.type.startsWith("image/"));
    setImages((prev) => [...prev, ...validFiles]);
    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setImagePreviews((prev) => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!inputText.trim() && images.length === 0) { setError("Please enter text or upload an image."); return; }
    if (!apiKey.trim()) { setError("Please set your Claude API key in Settings."); setShowSettings(true); return; }

    setLoading(true); setError(null); setOutput(null);
    try {
      const imageDescs = images.map((f) => `[Uploaded image: ${f.name}]`);
      const effectiveType = autoDetectType ? "bug" : ticketType;
      const result = await callClaude(apiKey, buildPrompt(inputText, effectiveType, imageDescs), images);
      const now = new Date().toISOString();
      setOutput(result);
      setActiveTab('jira');
      const record: TicketRecord = {
        id: Date.now().toString(), createdAt: now, statusUpdatedAt: now,
        title: parseTitle(result.jiraTicket), priority: parsePriority(result.jiraTicket),
        ticketType: effectiveType, status: 'New', output: result,
      };
      setCurrentRecordId(record.id);
      onAddRecord(record);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  }, [inputText, images, apiKey, ticketType, autoDetectType, setShowSettings, onAddRecord]);

  const handleClear = useCallback(() => {
    setInputText(""); setImages([]); setImagePreviews([]); setOutput(null); setError(null);
    setActiveTab('jira'); setCurrentRecordId(null);
  }, []);

  const handleReviseTicket = useCallback((revisedTicket: string) => {
    setOutput((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, jiraTicket: revisedTicket };
      if (currentRecordId) {
        onUpdateRecord(currentRecordId, {
          title: parseTitle(revisedTicket),
          priority: parsePriority(revisedTicket),
          output: updated,
        });
      }
      return updated;
    });
  }, [currentRecordId, onUpdateRecord]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Input panel */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />Input
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {showSettings && (
              <div className="p-3 bg-muted/40 rounded-lg space-y-3 fade-in">
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Claude API Key</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={autoDetectType} onCheckedChange={setAutoDetectType} />
                  <Label className="text-xs">Auto-detect ticket type</Label>
                </div>
              </div>
            )}

            {!autoDetectType && (
              <div className="fade-in">
                <Label className="text-xs font-medium mb-1.5 block">Ticket Type</Label>
                <Select value={ticketType} onValueChange={setTicketType}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bug">Bug Report</SelectItem>
                    <SelectItem value="feature">Feature Request</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs font-medium mb-1.5 block">
                Description <span className="text-muted-foreground">(Korean or English)</span>
              </Label>
              <Textarea placeholder={"예: EPG 프로모 배너가 광고 차단기 활성화 시 클릭 안 됨\n\nor paste a full PRD..."}
                value={inputText} onChange={(e) => setInputText(e.target.value)} className="min-h-[180px] text-sm resize-y" />
            </div>

            <div>
              <Label className="text-xs font-medium mb-1.5 block">Attachments</Label>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="w-full h-20 border-dashed flex flex-col gap-1">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Click to upload images</span>
              </Button>
              {imagePreviews.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {imagePreviews.map((src, i) => (
                    <div key={i} className="relative group/img">
                      <img src={src} alt={`upload-${i}`} className="h-16 w-16 rounded-md object-cover border" />
                      <button onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />
            <div className="flex gap-2">
              <Button onClick={handleGenerate} disabled={loading} className="flex-1 h-10 font-semibold">
                {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</> : <><Zap className="h-4 w-4 mr-2" />Generate</>}
              </Button>
              <Button variant="outline" onClick={handleClear} disabled={loading} className="h-10">Clear</Button>
            </div>
            {error && <div className="bg-destructive/10 text-destructive text-sm rounded-lg p-3 fade-in">{error}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Quick Examples</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Bug", text: "웹에서 EPG 프로모 배너가 광고 차단기 활성화 시 클릭이 안 됩니다. 크롬 브라우저에서만 발생합니다." },
              { label: "Feature", text: "사용자가 시청 기록을 CSV로 내보내기 할 수 있는 기능이 필요합니다. 설정 페이지에서 접근 가능하도록 해주세요." },
              { label: "Bug", text: "모바일 앱에서 영상 재생 중 자막이 갑자기 사라집니다. iOS 17.4 이상에서 발생합니다." },
            ].map((ex, i) => (
              <button key={i} onClick={() => setInputText(ex.text)} className="w-full text-left p-2.5 rounded-md hover:bg-muted transition-colors">
                <Badge variant="secondary" className="text-[10px] mb-1">{ex.label}</Badge>
                <p className="text-xs text-muted-foreground line-clamp-2">{ex.text}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Output panel */}
      <div className="lg:col-span-3">
        {!output && !loading && (
          <div className="flex flex-col items-center justify-center h-[400px] text-center text-muted-foreground">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4"><Zap className="h-8 w-8" /></div>
            <h3 className="font-semibold text-foreground mb-1">Ready to generate</h3>
            <p className="text-sm max-w-xs">Enter your input in Korean or English, then click Generate.</p>
            {history.length > 0 && (
              <p className="text-xs mt-3 text-muted-foreground">
                {history.length} ticket{history.length > 1 ? 's' : ''} in history — view them in <span className="text-primary font-medium">Ticket List</span>
              </p>
            )}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
            <h3 className="font-semibold mb-1">Generating outputs...</h3>
            <p className="text-sm text-muted-foreground">Analyzing input, translating, and structuring outputs</p>
          </div>
        )}

        {output && !loading && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="fade-in">
            <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
              <TabsTrigger value="jira" className="flex-1 min-w-[60px] gap-1 text-xs">
                <FileText className="h-3 w-3" /><span className="hidden sm:inline">Jira</span>
              </TabsTrigger>
              <TabsTrigger value="slack" className="flex-1 min-w-[60px] gap-1 text-xs">
                <MessageSquare className="h-3 w-3" />Slack
              </TabsTrigger>
              <TabsTrigger value="followup" className="flex-1 min-w-[60px] gap-1 text-xs">
                <HelpCircle className="h-3 w-3" />Q&amp;A
              </TabsTrigger>
              <TabsTrigger value="pmnotes" className="flex-1 min-w-[60px] gap-1 text-xs">
                <AlertTriangle className="h-3 w-3" />PM
              </TabsTrigger>
              <TabsTrigger value="refine" className="flex-1 min-w-[60px] gap-1 text-xs">
                <Search className="h-3 w-3" />Refine
              </TabsTrigger>
            </TabsList>

            <TabsContent value="jira" className="mt-4">
              <JiraTicketEditor
                ticketText={output.jiraTicket}
                ticketType={autoDetectType ? 'bug' : ticketType}
                onUpdateTicket={handleReviseTicket}
                onSendToJira={(fields) => {
                  localStorage.setItem('drjira-send-to-jira', JSON.stringify({
                    ...fields, timestamp: new Date().toISOString(), status: 'pending',
                  }));
                }}
              />
            </TabsContent>

            <TabsContent value="slack" className="mt-4 space-y-4">
              <OutputSection title="Standard" content={output.slackStandard} />
              <Separator />
              <OutputSection title="Polished / Formal" content={output.slackPolished} />
              <Separator />
              <OutputSection title="Urgent / Action-Oriented" content={output.slackUrgent} />
            </TabsContent>

            <TabsContent value="followup" className="mt-4">
              <FollowUpTab questions={output.followUpQuestions} jiraTicket={output.jiraTicket}
                apiKey={apiKey} onReviseTicket={handleReviseTicket} />
            </TabsContent>

            <TabsContent value="pmnotes" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">PM Assistant Notes<CopyButton text={output.pmNotes} /></CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/50 rounded-lg p-4 font-[inherit]">{output.pmNotes}</pre>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="refine" className="mt-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Deep Refinement Questions</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {output.refinementQuestions.map((q, i) => (
                      <li key={i} className="flex gap-2 text-sm items-start">
                        <Badge variant="outline" className="text-[10px] mt-0.5 shrink-0">R{i + 1}</Badge>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

// ── Root App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem('drjira-unlocked') === 'true');
  const [isDark, setIsDark] = useState(() => localStorage.getItem('drjira-theme') === 'dark');
  const [page, setPage] = useState<Page>('daily');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("drjira-api-key") ?? "");
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem("drjira-openai-key") ?? "");
  const [showSettings, setShowSettings] = useState(false);

  const [history, setHistory] = useState<TicketRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('drjira-history') ?? '[]'); }
    catch { return []; }
  });
  const [sortField, setSortField] = useState<SortField>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [comments, setComments] = useState<CommentEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('drjira-comments') ?? '[]'); }
    catch { return []; }
  });
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('drjira-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const handleApiKeyChange = useCallback((val: string) => {
    setApiKey(val); localStorage.setItem("drjira-api-key", val);
  }, []);

  const handleOpenaiKeyChange = useCallback((val: string) => {
    setOpenaiKey(val); localStorage.setItem("drjira-openai-key", val);
  }, []);


  const handleAddRecord = useCallback((record: TicketRecord) => {
    setHistory((prev) => {
      const updated = [record, ...prev].slice(0, 50);
      localStorage.setItem('drjira-history', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleUpdateRecord = useCallback((id: string, updates: Partial<TicketRecord>) => {
    setHistory((prev) => {
      const updated = prev.map((r) => r.id === id ? { ...r, ...updates } : r);
      localStorage.setItem('drjira-history', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleDeleteRecord = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      localStorage.setItem('drjira-history', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
      else setSortDir('asc');
      return field;
    });
  }, []);

  const handleStatusChange = useCallback((id: string, status: TicketStatus) => {
    setHistory((prev) => {
      const updated = prev.map((r) => r.id === id ? { ...r, status, statusUpdatedAt: new Date().toISOString() } : r);
      localStorage.setItem('drjira-history', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleMilestoneDateChange = useCallback((id: string, date: string) => {
    setHistory((prev) => {
      const updated = prev.map((r) => r.id === id ? { ...r, milestoneDate: date || undefined } : r);
      localStorage.setItem('drjira-history', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleAddComment = useCallback((text: string, section: string) => {
    const entry: CommentEntry = { id: Date.now().toString(), text, section, createdAt: new Date().toISOString() };
    setComments((prev) => { const updated = [entry, ...prev]; localStorage.setItem('drjira-comments', JSON.stringify(updated)); return updated; });
  }, []);

  const handleDeleteComment = useCallback((id: string) => {
    setComments((prev) => { const updated = prev.filter((c) => c.id !== id); localStorage.setItem('drjira-comments', JSON.stringify(updated)); return updated; });
  }, []);

  if (!unlocked) return <PasscodePage onUnlock={() => setUnlocked(true)} />;

  return (
    <div className="min-h-screen notebook-bg">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/85 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="logo" className="h-20 dark:invert dark:opacity-80" />
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setIsDark((d) => !d)} className="h-8 w-8 p-0">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSettings(!showSettings)} className="gap-1.5">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </div>
        </div>

        {showSettings && (
          <div className="border-t bg-muted/30 fade-in">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                <div className="flex-1 w-full sm:max-w-md">
                  <Label className="text-xs font-medium mb-1.5 block">Claude API Key</Label>
                  <Input type="password" placeholder="sk-ant-..." value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="flex-1 w-full sm:max-w-md">
                  <Label className="text-xs font-medium mb-1.5 block">
                    OpenAI API Key <span className="text-muted-foreground">(Translator)</span>
                  </Label>
                  <Input type="password" placeholder="sk-..." value={openaiKey}
                    onChange={(e) => handleOpenaiKeyChange(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Body: sidebar + content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex gap-6">
        <SideNav page={page} onChangePage={setPage} />

        <div className="flex-1 min-w-0">
          <MobileNav page={page} onChangePage={setPage} />

          {page === 'daily' && <DailyPage apiKey={apiKey} />}
          {page === 'ticket' && (
            <TicketGeneratorPage
              apiKey={apiKey}
              showSettings={showSettings}
              setShowSettings={setShowSettings}
              history={history}
              onAddRecord={handleAddRecord}
              onUpdateRecord={handleUpdateRecord}
            />
          )}
          {page === 'translate' && <TranslatePage apiKey={apiKey} openaiKey={openaiKey} />}
          {page === 'meeting' && <MeetingNotesPage apiKey={apiKey} />}
          {page === 'tools' && <ToolsPage />}
          {page === 'ideas' && <IdeaMemoPage />}
          {page === 'list' && (
            <ListPage
              history={history}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              onStatusChange={handleStatusChange}
              onMilestoneDateChange={handleMilestoneDateChange}
              onDelete={handleDeleteRecord}
            />
          )}
        </div>
      </div>

      {/* Floating comment button */}
      <button onClick={() => setShowComments(true)}
        className="fixed bottom-6 right-6 z-30 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-110 transition-all flex items-center justify-center animate-float"
        title="Comments">
        <MessageCircle className="h-5 w-5" />
        {comments.length > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
            {comments.length > 9 ? '9+' : comments.length}
          </span>
        )}
      </button>

      <CommentDrawer open={showComments} onClose={() => setShowComments(false)}
        comments={comments} onAdd={handleAddComment} onDelete={handleDeleteComment} />
    </div>
  );
}
