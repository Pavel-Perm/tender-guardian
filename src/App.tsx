import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ThemeProvider } from "@/components/ThemeProvider";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import NewAnalysis from "./pages/NewAnalysis";
import AnalysisResults from "./pages/AnalysisResults";
import RequiredDocuments from "./pages/RequiredDocuments";
import Profile from "./pages/Profile";
import AdminPanel from "./pages/AdminPanel";
import ParticipantType from "./pages/ParticipantType";
import BidPreparation from "./pages/BidPreparation";
import DocumentGeneration from "./pages/DocumentGeneration";
import BidAmount from "./pages/BidAmount";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/analysis/new" element={<ProtectedRoute><NewAnalysis /></ProtectedRoute>} />
            <Route path="/analysis/:id" element={<ProtectedRoute><AnalysisResults /></ProtectedRoute>} />
            <Route path="/analysis/:id/participant" element={<ProtectedRoute><ParticipantType /></ProtectedRoute>} />
            <Route path="/analysis/:id/documents" element={<ProtectedRoute><RequiredDocuments /></ProtectedRoute>} />
            <Route path="/analysis/:id/bid-preparation" element={<ProtectedRoute><BidPreparation /></ProtectedRoute>} />
            <Route path="/analysis/:id/bid-amount" element={<ProtectedRoute><BidAmount /></ProtectedRoute>} />
            <Route path="/analysis/:id/generate-documents" element={<ProtectedRoute><DocumentGeneration /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
