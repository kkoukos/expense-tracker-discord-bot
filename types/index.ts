import type { ObjectId } from "mongodb";

export type ExpenseCategory =
  | "Groceries"
  | "Fuel"
  | "Dining"
  | "Transport"
  | "Health"
  | "Shopping"
  | "Utilities"
  | "Entertainment"
  | "Other";

export interface ParsedExpense {
  merchant: string | null;
  amount: number | null;
  currency: string;
  category: ExpenseCategory;
  items: string[];
  date: string | null;
}

export interface ExpenseDoc {
  _id?: ObjectId;
  userId: string;
  username: string;
  merchant: string | null;
  amount: number | null;
  currency: string;
  category: ExpenseCategory;
  items: string[];
  date: Date;
  loggedAt: Date;
  messageId: string;
  rawText: string | null;
  hasImage: boolean;
}

export interface SummaryRow {
  _id: ExpenseCategory;
  total: number;
  count: number;
}
