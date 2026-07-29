import { ensureRuntimeSchema } from "@/db/runtime";

type WorkflowPayload = {
  kind?: "request" | "review" | "designer" | "reflection";
  caseId?: string;
  scenarioId?: string;
  intent?: string;
  reviewPackage?: unknown;
  decision?: string;
  reason?: string;
  response?: string;
  attachments?: string[];
  status?: string;
  note?: string;
};

const DEFAULT_CASE_ID = "DET-2022-P098";

export async function GET(request: Request) {
  try {
    const caseId = new URL(request.url).searchParams.get("caseId") ?? DEFAULT_CASE_ID;
    const db = await ensureRuntimeSchema();
    const [review, designer, reflection, timeline] = await db.batch([
      db.prepare("SELECT * FROM expert_reviews WHERE case_id = ?").bind(caseId),
      db.prepare("SELECT * FROM designer_responses WHERE case_id = ?").bind(caseId),
      db.prepare("SELECT * FROM reflection_checks WHERE case_id = ?").bind(caseId),
      db
        .prepare(
          "SELECT * FROM timeline_events WHERE case_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
        )
        .bind(caseId),
    ]);

    return Response.json({
      caseId,
      review: review.results[0] ?? null,
      designer: designer.results[0] ?? null,
      reflection: reflection.results[0] ?? null,
      timeline: timeline.results,
      persistence: "D1",
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "workflow unavailable",
        persistence: "unavailable",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as WorkflowPayload;
    const caseId = payload.caseId?.trim() || DEFAULT_CASE_ID;
    const db = await ensureRuntimeSchema();

    if (payload.kind === "request") {
      const intent = payload.intent?.trim();
      if (!intent || !payload.reviewPackage) {
        return Response.json(
          { error: "intent and reviewPackage are required" },
          { status: 400 },
        );
      }
      await db
        .prepare(
          "INSERT INTO timeline_events (case_id, actor, title, detail) VALUES (?, ?, ?, ?)",
        )
        .bind(
          caseId,
          "AI Review Copilot",
          "전문가 검토 요청",
          JSON.stringify({
            intent,
            scenarioId: payload.scenarioId?.trim() ?? "",
            reviewPackage: payload.reviewPackage,
          }),
        )
        .run();
    } else if (payload.kind === "review") {
      const decision = payload.decision?.trim();
      const reason = payload.reason?.trim();
      if (!decision || !reason) {
        return Response.json({ error: "decision and reason are required" }, { status: 400 });
      }
      await db.batch([
        db
          .prepare(`INSERT INTO expert_reviews (case_id, decision, reason, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(case_id) DO UPDATE SET
              decision = excluded.decision,
              reason = excluded.reason,
              updated_at = CURRENT_TIMESTAMP`)
          .bind(caseId, decision, reason),
        db
          .prepare(
            "INSERT INTO timeline_events (case_id, actor, title, detail) VALUES (?, ?, ?, ?)",
          )
          .bind(caseId, "교통전문가", `${decision} 판정`, reason),
      ]);
    } else if (payload.kind === "designer") {
      const response = payload.response?.trim();
      if (!response) {
        return Response.json({ error: "response is required" }, { status: 400 });
      }
      const reason = payload.reason?.trim() ?? "";
      const attachments = JSON.stringify(payload.attachments ?? []);
      await db.batch([
        db
          .prepare(`INSERT INTO designer_responses
            (case_id, response, reason, attachments, submitted_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(case_id) DO UPDATE SET
              response = excluded.response,
              reason = excluded.reason,
              attachments = excluded.attachments,
              status = '재제출',
              submitted_at = CURRENT_TIMESTAMP`)
          .bind(caseId, response, reason, attachments),
        db
          .prepare(
            "INSERT INTO timeline_events (case_id, actor, title, detail) VALUES (?, ?, ?, ?)",
          )
          .bind(caseId, "한빛건축 설계팀", "수정안 재제출", response),
      ]);
    } else if (payload.kind === "reflection") {
      const status = payload.status?.trim();
      const note = payload.note?.trim() ?? "";
      if (!status) {
        return Response.json({ error: "status is required" }, { status: 400 });
      }
      await db.batch([
        db
          .prepare(`INSERT INTO reflection_checks (case_id, status, note, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(case_id) DO UPDATE SET
              status = excluded.status,
              note = excluded.note,
              updated_at = CURRENT_TIMESTAMP`)
          .bind(caseId, status, note),
        db
          .prepare(
            "INSERT INTO timeline_events (case_id, actor, title, detail) VALUES (?, ?, ?, ?)",
          )
          .bind(caseId, "LH 담당자", `최종 반영 상태 · ${status}`, note),
      ]);
    } else {
      return Response.json({ error: "unsupported workflow kind" }, { status: 400 });
    }

    return Response.json({ ok: true, caseId, persistence: "D1" }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "workflow unavailable" },
      { status: 503 },
    );
  }
}
