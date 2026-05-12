import asyncio
from dotenv import load_dotenv
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
from livekit.plugins import google, openai, deepgram

load_dotenv()

# --- STEP 1: DEFINE THE TOOLS (THE "DO EVERYTHING" PART) ---
class OmniTools(llm.FunctionContext):
    @llm.ai_callable(description="Optimizes laptop performance by clearing RAM and background tasks.")
    async def optimize_system(self):
        # You can add OS-specific commands here (e.g., killing heavy processes)
        print("AGENT ACTION: Optimizing OMEN performance...")
        return "System optimized. Background tasks cleared."

    @llm.ai_callable(description="Calculates the current milk bill based on logs.")
    async def get_milk_bill(self):
        # In a real app, this would query your local database
        return "Your current pending bill is ₹1,450 for 25 liters."

    @llm.ai_callable(description="Searches for academic topics like Disk Scheduling or Graph Theory.")
    async def search_academic_notes(self, topic: str):
        return f"Found notes for {topic}: C-LOOK is more efficient as it jumps directly back to the start."

# --- STEP 2: THE MAIN AGENT LOGIC ---
async def entrypoint(ctx: JobContext):
    # Connect to the LiveKit room (where audio flows)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Initialize the "Brain" (Using Gemini 3.5 Flash Live for 2026 speeds)
    model = google.beta.GeminiLiveModel() 
    
    # Initialize the Agent
    agent = llm.ChatAgent(
        model=model,
        fnc_ctx=OmniTools(),
        system_prompt=(
            "You are a Live Personal Assistant. You help with engineering studies, "
            "laptop optimization, and daily utility tasks. Be concise and proactive."
        )
    )

    # Start the conversation
    agent.start(ctx.room)
    await agent.say("I am online. How can I help with your OMEN system or your studies today?", allow_interruptions=True)

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
