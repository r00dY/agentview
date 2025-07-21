import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isAsyncIterable(obj: any) {
  return obj != null && typeof obj[Symbol.asyncIterator] === 'function';
}
