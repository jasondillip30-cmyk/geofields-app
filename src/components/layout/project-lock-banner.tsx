"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";

interface ProjectLockBannerProps {
  projectId: string;
}

interface Project {
  id: string;
  name: string;
}

export function ProjectLockBanner({ projectId }: ProjectLockBannerProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectId === "all") {
      return;
    }

    const fetchProject = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          setProject(data);
        }
      } catch {
        // Ignore errors
      } finally {
        setLoading(false);
      }
    };

    void fetchProject();
  }, [projectId]);

  if (projectId === "all" || loading || !project) {
    return null;
  }

  return (
    <Card className="border-amber-200 bg-amber-50/90 text-amber-900 shadow-[0_1px_2px_rgba(245,158,11,0.10)]">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">Project locked: {project.name}</p>
        <p className="text-xs text-amber-800">All data and actions in this view are limited to this project.</p>
      </div>
    </Card>
  );
}