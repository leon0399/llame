import { useQuery } from "@tanstack/react-query";
import { use } from "react";

const PROJECTS_MOCK_DATA = [
  {
    id: "project-1",
    name: "VR Haptics",
    lastMessageAt: new Date().setDate(new Date().getDate() - 1),
  },
  {
    id: "project-2",
    name: "AI Customer Loyalty Program",
    lastMessageAt: new Date().setDate(new Date().getDate() - 2),
  },
  {
    id: "project-3",
    name: "Post-Quantum Blockchain",
    lastMessageAt: new Date().setDate(new Date().getDate() - 3),
  },
  {
    id: "project-4",
    name: "AI-Powered Explorer Drone Swarm",
    lastMessageAt: new Date().setDate(new Date().getDate() - 4),
  },
  {
    id: "project-5",
    name: "Branching LLM Frontend",
    lastMessageAt: new Date().setDate(new Date().getDate() - 5),
  },
  {
    id: "project-6",
    name: "LLM-Powered Dynamic Home Automation",
    lastMessageAt: new Date().setDate(new Date().getDate() - 6),
  }
];

type Project = typeof PROJECTS_MOCK_DATA[number];

export const useProjects = () => useQuery<Project[]>({
  queryKey: ["projects"],
  queryFn: async () => {
    // Simulate a network request
    await new Promise(resolve => setTimeout(resolve, 1000));
    return PROJECTS_MOCK_DATA;
  },
  select: (data) => data.sort((a, b) => b.lastMessageAt - a.lastMessageAt),
});