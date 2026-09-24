import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const studentId = "ad754535-6873-4539-bb23-6f33aa2cd95f";
const { data, error } = await db.from("student_profiles").select("user_id, section_id, program_id, year_level_id, updated_at").eq("user_id", studentId).maybeSingle();
console.log("error:", error?.message ?? "none");
console.log("profile:", JSON.stringify(data));
if (data?.section_id) {
  const { data: sec } = await db.from("sections").select("id, name, program_id, year_level_id").eq("id", data.section_id).maybeSingle();
  console.log("section row:", JSON.stringify(sec));
}
const { data: allSections } = await db.from("sections").select("id, name, program_id, year_level_id").order("name");
console.log("all sections:", JSON.stringify(allSections));
