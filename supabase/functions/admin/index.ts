import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { action, email, password, fullName, userId, role } = await req.json();

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin");
        if (!roles || roles.length === 0) {
          // Allow only setup-admin action without auth check
          if (action !== "setup-admin") {
            throw new Error("Unauthorized: admin role required");
          }
        }
      }
    }

    if (action === "setup-admin") {
      // Create admin user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: email || "admin@tenderanaliz.ru",
        password: password || "Admin123!",
        email_confirm: true,
        user_metadata: { full_name: fullName || "Администратор" },
      });

      if (authError) throw authError;

      // Assign admin role
      await supabase.from("user_roles").insert({
        user_id: authData.user.id,
        role: "admin",
      });

      return new Response(JSON.stringify({ success: true, userId: authData.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list-users") {
      const { data: { users }, error } = await supabase.auth.admin.listUsers();
      if (error) throw error;

      const { data: profiles } = await supabase.from("profiles").select("*");
      const { data: userRoles } = await supabase.from("user_roles").select("*");
      const { data: analysesCounts } = await supabase
        .from("analyses")
        .select("user_id");

      const enriched = users.map(u => {
        const profile = profiles?.find(p => p.user_id === u.id);
        const roles = userRoles?.filter(r => r.user_id === u.id).map(r => r.role) || [];
        const analysesCount = analysesCounts?.filter(a => a.user_id === u.id).length || 0;
        return {
          id: u.id,
          email: u.email,
          fullName: profile?.full_name || "",
          company: profile?.company || "",
          roles,
          analysesCount,
          createdAt: u.created_at,
          lastSignIn: u.last_sign_in_at,
        };
      });

      return new Response(JSON.stringify({ users: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "assign-role") {
      if (!userId || !role) throw new Error("userId and role required");
      const { error } = await supabase.from("user_roles").upsert({
        user_id: userId,
        role,
      }, { onConflict: "user_id,role" });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "remove-role") {
      if (!userId || !role) throw new Error("userId and role required");
      const { error } = await supabase.from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", role);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "stats") {
      const { count: usersCount } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      const { count: analysesCount } = await supabase.from("analyses").select("*", { count: "exact", head: true });
      const { data: riskStats } = await supabase.from("analyses").select("overall_risk").not("overall_risk", "is", null);

      const stats = {
        totalUsers: usersCount || 0,
        totalAnalyses: analysesCount || 0,
        riskDistribution: {
          ok: riskStats?.filter(r => r.overall_risk === "ok").length || 0,
          warning: riskStats?.filter(r => r.overall_risk === "warning").length || 0,
          critical: riskStats?.filter(r => r.overall_risk === "critical").length || 0,
        },
      };

      return new Response(JSON.stringify(stats), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unknown action");
  } catch (e) {
    console.error("admin error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
