CREATE TYPE "DrillingShift" AS ENUM ('DAY', 'NIGHT');
ALTER TABLE "DrillReport" ADD COLUMN "shift" "DrillingShift";
