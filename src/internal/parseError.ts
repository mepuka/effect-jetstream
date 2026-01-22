/**
 * @since 1.0.0
 */
import * as ParseResult from "effect/ParseResult"

const DEFAULT_MAX_ISSUES = 3
const DEFAULT_MAX_LENGTH = 240

const formatPath = (path: ReadonlyArray<PropertyKey>): string => {
  if (path.length === 0) {
    return "<root>"
  }
  return path.map((segment) => String(segment)).join(".")
}

const formatIssue = (issue: ParseResult.ArrayFormatterIssue): string => {
  const path = formatPath(issue.path)
  return path === "<root>" ? issue.message : `${path}: ${issue.message}`
}

export const summarizeParseError = (
  error: ParseResult.ParseError,
  options?: {
    readonly maxIssues?: number
    readonly maxLength?: number
  }
): string => {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error)
  if (issues.length === 0) {
    return "unknown validation error"
  }
  const maxIssues = options?.maxIssues ?? DEFAULT_MAX_ISSUES
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH
  const head = issues.slice(0, maxIssues).map(formatIssue).join("; ")
  const remaining = issues.length - maxIssues
  const withCount = remaining > 0 ? `${head} (+${remaining} more)` : head
  return withCount.length > maxLength ? `${withCount.slice(0, maxLength)}...` : withCount
}
