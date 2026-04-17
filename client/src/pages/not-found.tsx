import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
      <div className="text-6xl font-bold text-muted-foreground/30">404</div>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Button asChild variant="outline">
        <Link href="/"><Home className="w-4 h-4 mr-2" />Back to Dashboard</Link>
      </Button>
    </div>
  );
}
