"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/kb/api";
import { useStatus } from "@/lib/kb/StatusContext";
import type { CommandResponse, HealthCheckResponse } from "@/lib/kb/types";
import {
  SectionCard,
  ModelSelect,
  CommandResultPanel,
  RecommendationBar,
  ActionButton,
} from "@/components/kb/shared";

export function QualityTab() {
  const { model } = useStatus();

  // Lint state
  const [lintResult, setLintResult] = useState<CommandResponse | null>(null);
  const [linting, setLinting] = useState(false);

  // Health check state
  const [healthResult, setHealthResult] = useState<HealthCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const handleLint = async () => {
    setLinting(true);
    setLintResult(null);
    try {
      setLintResult(await api.lint());
    } catch (e) {
      setLintResult({ returncode: 1, output: String(e), command: "" });
    } finally {
      setLinting(false);
    }
  };

  const handleHealthCheck = async () => {
    if (!model) return;
    setChecking(true);
    setHealthResult(null);
    try {
      setHealthResult(await api.healthCheck({ model }));
    } catch (e) {
      setHealthResult({ returncode: 1, output: String(e), command: "", report: "" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Lint Wiki" description="Check broken markdown links and orphan pages.">
        <div className="flex items-center gap-2">
          <ActionButton onClick={handleLint} loading={linting} loadingText="Linting...">
            Run Lint
          </ActionButton>
        </div>
      </SectionCard>

      <CommandResultPanel result={lintResult} />

      {lintResult?.recommendations && (
        <RecommendationBar recommendations={lintResult.recommendations} />
      )}

      <SectionCard title="Health Check" description="LLM-powered review: find contradictions, unexplained topics, unsourced claims, and knowledge gaps.">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <ModelSelect value={model} />
          <div className="pt-5 sm:pt-0">
            <ActionButton onClick={handleHealthCheck} loading={checking} disabled={!model} loadingText="Reviewing...">
              Run Health Check
            </ActionButton>
          </div>
        </div>
      </SectionCard>

      {healthResult?.report && (
        <SectionCard title="Health Check Report">
          <div className="kb-markdown bg-linear-bg rounded-md p-4 transition-colors duration-150 ease-out">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{healthResult.report}</ReactMarkdown>
          </div>
        </SectionCard>
      )}

      <CommandResultPanel result={healthResult} />
    </div>
  );
}
