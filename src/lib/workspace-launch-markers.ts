export interface WorkspaceLaunchProjectMarkerInput {
  id: string;
  name: string;
  status?: string | null;
}

export interface WorkspaceLaunchMarker {
  id: string;
  location: [number, number];
  name: string;
  users: number;
  statusLabel: string;
}

const COORDINATE_POOL: Array<[number, number]> = [
  [37.78, -122.44],
  [52.52, 13.41],
  [35.68, 139.65],
  [-23.55, -46.63],
  [25.2, 55.27],
  [-33.87, 151.21],
  [51.5, -0.12],
  [19.43, -99.13],
  [1.29, 103.85],
  [30.04, 31.24],
  [-26.2, 28.04],
  [59.91, 10.75],
  [40.71, -74.01],
  [28.61, 77.2],
  [-34.6, -58.38]
];

export const FALLBACK_WORKSPACE_MARKERS: WorkspaceLaunchMarker[] = [
  { id: "node-1", location: COORDINATE_POOL[0], name: "Project node 1", users: 1820, statusLabel: "Active" },
  { id: "node-2", location: COORDINATE_POOL[1], name: "Project node 2", users: 1260, statusLabel: "On hold" },
  { id: "node-3", location: COORDINATE_POOL[2], name: "Project node 3", users: 980, statusLabel: "Active" },
  { id: "node-4", location: COORDINATE_POOL[3], name: "Project node 4", users: 760, statusLabel: "Planned" }
];

export function buildDeterministicProjectMarkers(
  projects: WorkspaceLaunchProjectMarkerInput[]
): WorkspaceLaunchMarker[] {
  if (projects.length === 0) {
    return [];
  }

  const usedIndices = new Set<number>();
  const sortedProjects = [...projects].sort((left, right) => left.id.localeCompare(right.id));

  return sortedProjects.map((project, index) => {
    const hash = hashString(project.id);
    const startIndex = hash % COORDINATE_POOL.length;
    const coordinateIndex = findAvailableCoordinateIndex(startIndex, usedIndices);
    const coordinate =
      coordinateIndex >= 0
        ? COORDINATE_POOL[coordinateIndex]
        : generateOverflowCoordinate(hash, index);
    if (coordinateIndex >= 0) {
      usedIndices.add(coordinateIndex);
    }

    return {
      id: project.id,
      location: coordinate,
      name: project.name,
      users: 520 + ((hash % 2600) + 1),
      statusLabel: toStatusLabel(project.status)
    };
  });
}

function toStatusLabel(status: string | null | undefined) {
  const normalized = `${status || ""}`.trim().toUpperCase();
  if (!normalized) {
    return "Planned";
  }
  return normalized.replaceAll("_", " ");
}

function findAvailableCoordinateIndex(startIndex: number, usedIndices: Set<number>) {
  for (let offset = 0; offset < COORDINATE_POOL.length; offset += 1) {
    const candidate = (startIndex + offset) % COORDINATE_POOL.length;
    if (!usedIndices.has(candidate)) {
      return candidate;
    }
  }
  return -1;
}

function generateOverflowCoordinate(hash: number, sequence: number): [number, number] {
  const latitude = -58 + ((hash * 13 + sequence * 17) % 116);
  const longitude = -170 + ((hash * 29 + sequence * 31) % 340);
  return [latitude, longitude];
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
