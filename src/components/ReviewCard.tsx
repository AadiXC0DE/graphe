import { useState } from "react";
import type { ReviewVerdict } from "../agent/types";
import { REVIEW_WORDS } from "../agent/pi/review";
import "./ReviewCard.css";

type Props = {
  verdict: ReviewVerdict;
  /** Whether the fix is already on its way. */
  asked: boolean;
  onFix: () => void;
  /** Send the findings back to where the change came from. Absent when the
   *  verdict is not about a pull request. */
  onPost?: () => Promise<boolean>;
};

const SEVERITY = {
  0: "P0",
  1: "P1",
  2: "P2",
  3: "P3",
} as const;

const SEVERITY_WORDS = {
  0: "blocks shipping",
  1: "fix before shipping",
  2: "can wait",
  3: "a note",
} as const;

export default function ReviewCard({ verdict, asked, onFix, onPost }: Props) {
  const heading = REVIEW_WORDS[verdict.kind];
  const blocking = verdict.findings.some((finding) => finding.priority <= 1);
  const [posting, setPosting] = useState<"no" | "going" | "done" | "failed">("no");

  const post = (): void => {
    if (onPost === undefined || posting === "going" || posting === "done") return;
    setPosting("going");
    void onPost().then((landed) => setPosting(landed ? "done" : "failed"));
  };

  return (
    <section className={`review review--${verdict.kind}`}>
      <div className="review__head">
        <strong className="review__verdict">{heading}</strong>
        {verdict.kind === "ships" ? (
          <span className="review__tag">Checked</span>
        ) : (
          <span className="review__tag">{blocking ? "Blocking" : "Notes"}</span>
        )}
      </div>
      {verdict.summary !== "" && <p className="review__summary">{verdict.summary}</p>}
      {verdict.checks !== undefined && verdict.checks.length > 0 && (
        <p className="review__against">
          {REVIEW_WORDS.against} {verdict.checks.join(" \u00b7 ")}
        </p>
      )}

      <ul className="review__findings">
        {verdict.findings.map((finding, index) => (
          <li className="review__finding" key={index}>
            <span className={`review__sev review__sev--${finding.priority}`}>
              {SEVERITY[finding.priority]}
            </span>
            <div className="review__body">
              <p className="review__issue">{finding.issue}</p>
              {(finding.file !== undefined || finding.impact !== undefined) && (
                <p className="review__meta">
                  {finding.file !== undefined && (
                    <code className="review__place">
                      {finding.file}
                      {finding.line !== undefined ? `:${finding.line}` : ""}
                    </code>
                  )}
                  {finding.impact !== undefined && <span>{finding.impact}</span>}
                </p>
              )}
              <p className="review__confidence">
                {REVIEW_WORDS.confidence} {finding.confidence}%
                <span className="review__level">{SEVERITY_WORDS[finding.priority]}</span>
              </p>
            </div>
          </li>
        ))}
      </ul>

      {verdict.kind !== "ships" && !asked && (
        <button type="button" className="review__fix" onClick={onFix}>
          {REVIEW_WORDS.fix}
        </button>
      )}
      {verdict.kind !== "ships" && asked && (
        <p className="review__ondone">On it. Fixing the blocking findings now.</p>
      )}
      {verdict.pull !== undefined && onPost !== undefined && posting !== "done" && (
        <button
          type="button"
          className="review__post"
          onClick={post}
          disabled={posting === "going"}
        >
          {posting === "going" ? REVIEW_WORDS.posting : REVIEW_WORDS.post}
        </button>
      )}
      {posting === "done" && <p className="review__ondone">{REVIEW_WORDS.posted}</p>}
      {posting === "failed" && <p className="review__ondone">{REVIEW_WORDS.postFailed}</p>}
    </section>
  );
}