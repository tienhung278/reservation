import type { SeatStatus } from "@/lib/reservation/types";

export function formatDate(value?: string) {
  if (!value) {
    return "Not provided";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function statusClass(status: SeatStatus) {
  if (status === "available") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (status === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  return "border-slate-300 bg-slate-100 text-slate-700";
}

export function statusDotClass(status: SeatStatus) {
  if (status === "available") {
    return "bg-emerald-500";
  }

  if (status === "pending") {
    return "bg-amber-500";
  }

  return "bg-slate-500";
}
