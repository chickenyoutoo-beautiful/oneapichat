"""HTTP API for querying the bounded project self-description."""
from fastapi import Query
from engine.self_description import admit_self_context, self_summary
def register_self_endpoints(app, project_root):
    @app.get("/engine/self/describe")
    def self_describe():
        return {"ok": True, "self": self_summary(project_root)}
    @app.get("/engine/self/context")
    def self_context(query: str = Query(""), budget: int = Query(14000, ge=1000, le=50000)):
        return {"ok": True, "context": admit_self_context(project_root, query=query, budget=budget)}
