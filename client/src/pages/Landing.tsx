import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnnouncementBar } from "../landing/AnnouncementBar";
import { Header } from "../landing/Header";
import { Hero } from "../landing/Hero";
import { SocialProofTicker } from "../landing/SocialProofTicker";
import { HeroCommandCenter } from "../landing/HeroCommandCenter";
import { HeroVideo } from "../landing/HeroVideo";
import { ProblemSection } from "../landing/ProblemSection";
import { CrmSection } from "../landing/CrmSection";
import { LosSection } from "../landing/LosSection";
import { CreditBreSection } from "../landing/CreditBreSection";
import { UnderwritingSection } from "../landing/UnderwritingSection";
import { LmsSection } from "../landing/LmsSection";
import { PaymentsSection } from "../landing/PaymentsSection";
import { ReconciliationSection } from "../landing/ReconciliationSection";
import { CollectionsSection } from "../landing/CollectionsSection";
import { CustomerPortalSection } from "../landing/CustomerPortalSection";
import { DsaSection } from "../landing/DsaSection";
import { FieldSalesSection } from "../landing/FieldSalesSection";
import { ComplianceSection } from "../landing/ComplianceSection";
import { RiskSection } from "../landing/RiskSection";
import { EcosystemSection } from "../landing/EcosystemSection";
import { SniperAiSection } from "../landing/SniperAiSection";
import { Footer } from "../landing/Footer";
import { FloatingAiAssistant } from "../landing/FloatingAiAssistant";
import { DemoModal } from "../landing/DemoModal";

export default function Landing() {
  const nav = useNavigate();
  const [modal, setModal] = useState<{ isOpen: boolean; type: "demo" | "tour" }>({ isOpen: false, type: "demo" });

  const openDemo = () => setModal({ isOpen: true, type: "demo" });
  const openTour = () => setModal({ isOpen: true, type: "tour" });
  const closeModal = () => setModal((m) => ({ ...m, isOpen: false }));
  // "Live Sandbox" drops the visitor straight into the running platform
  const openApp = () => nav("/app");
  const goLogin = () => nav("/login");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-blue-600 selection:text-white">
      <AnnouncementBar onOpenTour={openTour} />
      <Header onOpenBookDemo={openDemo} onOpenTour={openTour} onOpenLiveDemo={openApp} onLogin={goLogin} />
      <main>
        <Hero onOpenBookDemo={openDemo} onOpenTour={openTour} onOpenLiveDemo={openApp} />
        <SocialProofTicker />
        <HeroCommandCenter onOpenLiveDemo={openApp} />
        <HeroVideo />

        <ProblemSection />
        <CrmSection />
        <LosSection />
        <CreditBreSection />
        <UnderwritingSection />
        <LmsSection />
        <PaymentsSection />
        <ReconciliationSection />
        <CollectionsSection />

        <CustomerPortalSection />
        <DsaSection />
        <FieldSalesSection />
        <ComplianceSection />
        <RiskSection />
        <EcosystemSection />

        <SniperAiSection />
      </main>
      <Footer />
      <FloatingAiAssistant onSelectAction={(actionType) => { if (actionType === "applications") nav("/app"); else if (actionType === "reconciliation") nav("/payments"); else nav("/risk"); }} />
      <DemoModal isOpen={modal.isOpen} type={modal.type} onClose={closeModal} />
    </div>
  );
}
