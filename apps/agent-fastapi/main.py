from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Union
import json
import asyncio
import time
import random

app = FastAPI(title="Agent FastAPI", version="1.0.0")

# Pydantic models for request/response
class Activity(BaseModel):
    id: str
    type: str
    role: str
    content: Any
    created_at: str
    run_id: Optional[str] = None

class Thread(BaseModel):
    id: str
    created_at: str
    updated_at: str
    metadata: Dict[str, Any]
    client_id: str
    type: str
    activities: List[Activity]

class RunRequest(BaseModel):
    thread: Thread


class VersionManifest(BaseModel):
    type: str = "manifest"
    version: str
    env: Optional[str] = "dev"
    metadata: Optional[Dict[str, Any]] = None

class ActivityResponse(BaseModel):
    type: str
    role: str
    content: Any

class ErrorResponse(BaseModel):
    message: str
    details: Optional[Dict[str, Any]] = None

@app.get("/")
async def root():
    return {"message": "Agent FastAPI Server"}


@app.post("/run_stream")
async def run(request: RunRequest):

    async def generate():
        try:
            # Emit version manifest first
            manifest = VersionManifest(
                version="1.0.2",
                env="dev",
                metadata={
                    "description": "Initial version of the agent",
                    "features": ["streaming", "lorem_ipsum_responses"]
                }
            )
            
            yield f"event: manifest\ndata: {json.dumps(manifest.dict())}\n\n"

            # Get the last user message
            last_user_message = request.thread.activities[-1].content if request.thread.activities else ""

            # Generate activities
            num_messages = 3

            for i in range(num_messages):
                # Check for error simulation
                if last_user_message.startswith("make_error."):
                    try:
                        error_num = int(last_user_message.split(".")[1])
                        if error_num == i:
                            error_response = ErrorResponse(
                                message="custom error"
                            )
                            yield f"event: error\ndata: {json.dumps(error_response.dict())}\n\n"
                            return
                    except (ValueError, IndexError):
                        pass

                # Simulate processing time
                await asyncio.sleep(1)

                # Generate lorem ipsum content
                lorem_variants = [
                    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
                    "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.\n\nNemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incididunt ut labore et dolore magnam aliquam quaerat voluptatem. \n\nUt enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?"
                ]
                
                content = random.choice(lorem_variants)
                
                activity = ActivityResponse(
                    type="message",
                    role="assistant",
                    content=content
                )

                yield f"event: activity\ndata: {json.dumps(activity.dict())}\n\n"

        except Exception as e:
            error_response = ErrorResponse(
                message=str(e),
                details={"error_type": type(e).__name__}
            )
            yield f"event: error\ndata: {json.dumps(error_response.dict())}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream",
        }
    )


@app.post("/run")
async def run(request: RunRequest):
    manifest = VersionManifest(
        version="1.0.2",
        env="dev",
        metadata={
            "description": "Initial version of the agent",
            "features": ["streaming", "lorem_ipsum_responses"]
        }
    )

    # Get the last user message
    last_user_message = request.thread.activities[-1].content if request.thread.activities else ""

    # Generate activities
    num_messages = 3

    lorem_variants = [
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
        "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.\n\nNemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incididunt ut labore et dolore magnam aliquam quaerat voluptatem. \n\nUt enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?"
    ]

    activities: List[ActivityResponse] = []

    for i in range(num_messages):
        content = random.choice(lorem_variants)
        
        activities.append(ActivityResponse(
            type="message",
            role="assistant",
            content=content
        ))

    return JSONResponse(
        status_code=200,
        content={
            "manifest": manifest.dict(),
            "activities": [a.dict() for a in activities]
        }
    )