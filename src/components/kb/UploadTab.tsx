"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/kb/api";
import { useStatus } from "@/lib/kb/StatusContext";
import { useCompile } from "@/lib/kb/CompileContext";
import type { CommandResponse } from "@/lib/kb/types";
import {
  SectionCard,
  ModelSelect,
  CommandResultPanel,
  RecommendationBar,
  ActionButton,
} from "@/components/kb/shared";
import { Upload, Globe, FileText } from "lucide-react";

type IngestMode = "files" | "url" | "pdf";

// Same field look as MediaStudio / H3StudioDashboard.
const FIELD =
  "mt-1 h-8 w-full rounded-md border border-linear-border bg-linear-bg px-2 text-xs text-linear-text focus:border-linear-accent focus:outline-none";

const SUB_TABS: { id: IngestMode; label: string; icon: string }[] = [
  { id: "files", label: "Files", icon: "Upload" },
  { id: "url", label: "URL", icon: "Globe" },
  { id: "pdf", label: "PDF", icon: "FileText" },
];

export function UploadTab() {
  const { model, refresh: refreshStatus, invalidate } = useStatus();
  const { compiling, liveLines: compileLines, result: compileResult, startCompile, stopCompile } = useCompile();
  const [mode, setMode] = useState<IngestMode>("files");

  // Files state
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  // URL state
  const [urls, setUrls] = useState("");
  const [crawl, setCrawl] = useState(false);
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(50);
  const [sameDomain, setSameDomain] = useState(true);
  const [pathFilter, setPathFilter] = useState("");
  const [respectRobots, setRespectRobots] = useState(true);
  const [crawlDelay, setCrawlDelay] = useState(1.0);
  const [downloadImages, setDownloadImages] = useState(false);
  const [maxImages, setMaxImages] = useState(20);
  const [urlTimeout, setUrlTimeout] = useState(30);

  // PDF state
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfMaxPages, setPdfMaxPages] = useState(0);
  const [copyOriginal, setCopyOriginal] = useState(false);

  // Compile state
  const [force, setForce] = useState(false);
  const [maxChars, setMaxChars] = useState(524288);
  const [idxForce, setIdxForce] = useState(false);
  const [indexing, setIndexing] = useState(false);

  const [result, setResult] = useState<CommandResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [urlFetching, setUrlFetching] = useState(false);
  const [liveLines, setLiveLines] = useState<string[]>([]);
  const liveRef = useRef<HTMLPreElement>(null);
  const compileLiveRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (liveRef.current) {
      liveRef.current.scrollTop = liveRef.current.scrollHeight;
    }
  }, [liveLines]);

  useEffect(() => {
    if (compileLiveRef.current) {
      compileLiveRef.current.scrollTop = compileLiveRef.current.scrollHeight;
    }
  }, [compileLines]);

  const addFiles = (files: File[]) => {
    setUploadFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      const unique = files.filter((f) => !existing.has(f.name + f.size));
      return [...prev, ...unique];
    });
  };

  const removeFile = (index: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const withRefresh = async (fn: () => Promise<void>) => {
    setLoading(true);
    setResult(null);
    try {
      await fn();
      refreshStatus();
    } finally {
      setLoading(false);
    }
  };

  const handleUploadFiles = () =>
    withRefresh(async () => {
      if (!uploadFiles.length) return;
      const res = await api.ingestUpload(uploadFiles);
      setResult({ returncode: 0, output: `Uploaded ${res.count} file(s):\n${res.saved.map((s) => `  ${s.name} (${(s.size / 1024).toFixed(1)} KB)`).join("\n")}`, command: "" });
      setUploadFiles([]);
    });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
  };

  const handleIngestUrl = async () => {
    const lines = urls.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;

    setLoading(true);
    setUrlFetching(true);
    setResult(null);
    setLiveLines([]);
    try {
      const { promise } = api.ingestUrlStream(
        {
          urls: lines,
          crawl,
          max_depth: maxDepth,
          max_pages: maxPages,
          same_domain: sameDomain,
          path_filter: pathFilter.trim() || null,
          respect_robots: respectRobots,
          delay: crawlDelay,
          download_images: downloadImages,
          max_images: maxImages,
          timeout: urlTimeout,
        },
        (line) => setLiveLines((prev) => [...prev, line]),
      );
      const res = await promise;
      setResult(res);
      setLiveLines([]);
      refreshStatus();
    } catch (e) {
      setResult({ returncode: 1, output: String(e), command: "" });
      setLiveLines([]);
    } finally {
      setUrlFetching(false);
      setLoading(false);
    }
  };

  const handleIngestPdf = () =>
    withRefresh(async () => {
      if (!pdfFiles.length) return;
      setResult(await api.ingestPdf(pdfFiles, pdfMaxPages, copyOriginal));
      setPdfFiles([]);
    });

  const handleCompile = async () => {
    setResult(null);
    const res = await startCompile({ model, force, max_source_chars: maxChars });
    if (res) setResult(res);
  };

  const handleBuildIndex = async () => {
    setIndexing(true);
    setResult(null);
    try {
      const res = await api.buildIndex({ force: idxForce });
      setResult(res);
      refreshStatus();
      // Fresh embeddings mean fresh similarity edges.
      invalidate();
    } catch (e) {
      setResult({ returncode: 1, output: String(e), command: "" });
    } finally {
      setIndexing(false);
    }
  };

  const displayResult = result ?? compileResult;

  return (
    <div className="space-y-6">
      {/* Ingest: Files / URL / PDF */}
      <div className="bg-linear-bg-secondary rounded-lg border border-linear-border overflow-hidden transition-colors duration-150 ease-out">
        <div className="flex overflow-x-auto border-b border-linear-border flex-shrink-0">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setMode(tab.id); setResult(null); }}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 ease-out ${
                mode === tab.id
                  ? "text-linear-accent border-b-2 border-linear-accent bg-linear-accent/10"
                  : "text-linear-text-secondary hover:text-linear-text"
              }`}
            >
              {tab.id === "files" && <Upload className="w-4 h-4" />}
              {tab.id === "url" && <Globe className="w-4 h-4" />}
              {tab.id === "pdf" && <FileText className="w-4 h-4" />}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {mode === "files" && (
            <div className="space-y-5">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors duration-150 ease-out ${
                  dragging ? "border-linear-accent bg-linear-accent/10" : "border-linear-border hover:border-linear-accent/60"
                }`}
              >
                <Upload className="w-8 h-8 text-linear-text-tertiary mx-auto mb-2" />
                <div className="text-base font-medium text-linear-text mb-1">Drop files here or click to upload</div>
                <div className="text-sm text-linear-text-secondary">Supports any file type</div>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  id="file-upload"
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files || []));
                    e.target.value = "";
                  }}
                />
                <label htmlFor="file-upload" className="mt-4 inline-block px-4 py-2 bg-linear-accent text-white rounded-md text-sm font-medium hover:bg-linear-accent-hover cursor-pointer transition-colors duration-150 ease-out">
                  Choose Files
                </label>
              </div>
              {uploadFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-linear-text">Selected ({uploadFiles.length})</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {uploadFiles.map((f, i) => (
                      <div key={f.name + i} className="flex items-center justify-between text-xs text-linear-text-secondary bg-linear-bg px-2 py-1.5 rounded-md transition-colors duration-150 ease-out">
                        <span>{f.name} ({(f.size / 1024).toFixed(1)} KB)</span>
                        <button
                          onClick={() => removeFile(i)}
                          className="text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded-md hover:bg-red-500/10 transition-colors duration-150 ease-out"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <ActionButton onClick={handleUploadFiles} loading={loading} loadingText="Uploading...">
                    Upload {uploadFiles.length} file(s)
                  </ActionButton>
                </div>
              )}
            </div>
          )}

          {mode === "url" && (
            <div className="space-y-4">
              <textarea
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                placeholder="https://example.com\nhttps://arxiv.org/abs/..."
                className="w-full h-28 px-3 py-2 border border-linear-border rounded-md text-sm bg-linear-bg text-linear-text placeholder:text-linear-text-tertiary focus:border-linear-accent focus:outline-none"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} className="accent-linear-accent" />
                  <span className="text-sm">Enable crawling</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={downloadImages} onChange={(e) => setDownloadImages(e.target.checked)} className="accent-linear-accent" />
                  <span className="text-sm">Download images</span>
                </label>
                <div>
                  <label className="text-xs text-linear-text-secondary">Max images</label>
                  <input type="number" min={1} max={200} value={maxImages} onChange={(e) => setMaxImages(Number(e.target.value))} className={FIELD} />
                </div>
                <div>
                  <label className="text-xs text-linear-text-secondary">Timeout (sec)</label>
                  <input type="number" min={5} max={300} value={urlTimeout} onChange={(e) => setUrlTimeout(Number(e.target.value))} className={FIELD} />
                </div>
              </div>
              {crawl && (
                <div className="rounded-lg border border-linear-border bg-linear-bg p-4 space-y-4 transition-colors duration-150 ease-out">
                  <div>
                    <div className="text-sm font-medium text-linear-text">Crawler controls</div>
                    <div className="text-xs text-linear-text-secondary mt-1">Breadth-first crawl with safety caps. Depth 0 means only the starting page.</div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                      <label className="text-xs text-linear-text-secondary">Max depth</label>
                      <input type="number" min={0} max={20} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} className={FIELD} />
                    </div>
                    <div>
                      <label className="text-xs text-linear-text-secondary">Max pages</label>
                      <input type="number" min={1} max={5000} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} className={FIELD} />
                    </div>
                    <div>
                      <label className="text-xs text-linear-text-secondary">Delay (sec)</label>
                      <input type="number" min={0} max={60} step={0.1} value={crawlDelay} onChange={(e) => setCrawlDelay(Number(e.target.value))} className={FIELD} />
                    </div>
                    <div>
                      <label className="text-xs text-linear-text-secondary">Path filter regex</label>
                      <input type="text" value={pathFilter} onChange={(e) => setPathFilter(e.target.value)} placeholder="^/docs/|^/blog/" className={FIELD} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={sameDomain} onChange={(e) => setSameDomain(e.target.checked)} className="accent-linear-accent" />
                      <span className="text-sm">Stay on same domain</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={respectRobots} onChange={(e) => setRespectRobots(e.target.checked)} className="accent-linear-accent" />
                      <span className="text-sm">Respect robots.txt</span>
                    </label>
                  </div>
                </div>
              )}
              <ActionButton onClick={handleIngestUrl} loading={loading} disabled={!urls.trim()} loadingText="Fetching...">
                {crawl ? "Ingest and Crawl URL(s)" : "Ingest URL(s)"}
              </ActionButton>
            </div>
          )}

          {mode === "pdf" && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-linear-border rounded-lg p-8 text-center hover:border-linear-accent/60 transition-colors duration-150 ease-out">
                <FileText className="w-8 h-8 text-linear-text-tertiary mx-auto mb-2" />
                <div className="text-base font-medium text-linear-text mb-1">Drop PDF files here</div>
                <div className="text-sm text-linear-text-secondary">Extracts text into markdown files</div>
                <input type="file" accept=".pdf" multiple onChange={(e) => setPdfFiles(Array.from(e.target.files || []))} className="hidden" id="pdf-upload" />
                <label htmlFor="pdf-upload" className="mt-4 inline-block px-4 py-2 bg-linear-accent text-white rounded-md text-sm font-medium hover:bg-linear-accent-hover cursor-pointer transition-colors duration-150 ease-out">
                  Choose PDFs
                </label>
              </div>
              {pdfFiles.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-linear-text mb-2">Selected ({pdfFiles.length})</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {pdfFiles.map((f) => (
                      <div key={f.name} className="text-xs text-linear-text-secondary bg-linear-bg px-2 py-1 rounded-md transition-colors duration-150 ease-out">
                        {f.name} ({(f.size / 1024).toFixed(1)} KB)
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-linear-text-secondary">Max pages (0 = all)</label>
                  <input type="number" min={0} max={5000} value={pdfMaxPages} onChange={(e) => setPdfMaxPages(Number(e.target.value))} className={FIELD} />
                </div>
                <label className="flex items-center gap-2 pt-5">
                  <input type="checkbox" checked={copyOriginal} onChange={(e) => setCopyOriginal(e.target.checked)} className="accent-linear-accent" />
                  <span className="text-sm">Copy original PDF</span>
                </label>
              </div>
              <ActionButton onClick={handleIngestPdf} loading={loading} disabled={!pdfFiles.length} loadingText="Extracting...">
                Extract PDF Text
              </ActionButton>
            </div>
          )}
        </div>
      </div>

      {/* Compile */}
      <SectionCard title="Compile Wiki" description="Generate wiki pages from raw sources using the LLM.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <ModelSelect value={model} />
          <div>
            <label className="text-xs text-linear-text-secondary">Max source chars</label>
            <select value={maxChars} onChange={(e) => setMaxChars(Number(e.target.value))} className={FIELD}>
              <option value={32000}>32K</option>
              <option value={55000}>55K</option>
              <option value={100000}>100K</option>
              <option value={192000}>192K (default)</option>
              <option value={250000}>250K (large context)</option>
              <option value={524288}>512K (max context)</option>
            </select>
          </div>
          <div className="flex flex-col gap-2 pt-5 sm:pt-0">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-linear-accent" />
              <span className="text-sm">Force recompile all docs</span>
            </label>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton onClick={handleCompile} loading={compiling} loadingText="Compiling...">
            Run Compile
          </ActionButton>
          {compiling && (
            <button
              onClick={stopCompile}
              className="ml-3 px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors duration-150 ease-out"
            >
              Stop Compile
            </button>
          )}
        </div>
      </SectionCard>

      <SectionCard title="FAISS Index" description="Build or rebuild the vector search index.">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={idxForce} onChange={(e) => setIdxForce(e.target.checked)} className="accent-linear-accent" />
            <span className="text-sm">Force rebuild index</span>
          </label>
        </div>
        <ActionButton onClick={handleBuildIndex} loading={indexing} loadingText="Building..." variant="secondary">
          Build FAISS Index
        </ActionButton>
      </SectionCard>

      {urlFetching && liveLines.length > 0 && (
        <div className="bg-linear-bg border border-linear-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-linear-accent text-sm animate-pulse">
              {crawl ? "Fetching and crawling..." : "Fetching..."}
            </span>
          </div>
          <pre ref={liveRef} className="text-xs text-linear-text-secondary overflow-auto max-h-64">{liveLines.join("\n")}</pre>
        </div>
      )}

      {compiling && compileLines.length > 0 && (
        <div className="bg-linear-bg border border-linear-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-linear-accent text-sm animate-pulse">Compiling...</span>
          </div>
          <pre ref={compileLiveRef} className="text-xs text-linear-text-secondary overflow-auto max-h-64">{compileLines.join("\n")}</pre>
        </div>
      )}

      <CommandResultPanel result={displayResult} />

      {displayResult?.recommendations && (
        <RecommendationBar
          recommendations={displayResult.recommendations}
          onAction={(rec) => {
            if (rec.action === "rebuild_index") handleBuildIndex();
          }}
          loading={indexing}
        />
      )}
    </div>
  );
}
