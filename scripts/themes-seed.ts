/** Add missing starting themes and upgrade unedited earlier versions: npm run themes:seed */
import { getDb } from "@/lib/db";
import { seedThemes } from "@/lib/themes/service";

seedThemes(getDb())
  .then(({ added, upgraded }) => {
    if (upgraded.length) console.log(`Updated ${upgraded.length} themes from the book: ${upgraded.join(", ")}`);
    if (added.length) console.log(`Added ${added.length} themes: ${added.join(", ")}`);
    if (!added.length && !upgraded.length) console.log("Starting themes are up to date.");
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
