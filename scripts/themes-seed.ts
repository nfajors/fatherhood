/** Insert the starting themes that don't exist yet: npm run themes:seed */
import { getDb } from "@/lib/db";
import { seedThemes } from "@/lib/themes/service";

seedThemes(getDb())
  .then((added) => {
    console.log(added.length ? `Added ${added.length} themes: ${added.join(", ")}` : "All starting themes already exist.");
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
