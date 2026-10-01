import { MotionTracking } from "../../components/motion/MotionTracking";

interface MotionTrackingPageProps {
  searchParams: Promise<{ patientId?: string }>;
}

export default async function MotionTrackingPage({ searchParams }: MotionTrackingPageProps) {
  const params = await searchParams;
  return <MotionTracking initialPatientId={params.patientId} />;
}
