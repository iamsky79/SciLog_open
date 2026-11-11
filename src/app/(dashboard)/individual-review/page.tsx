import { redirect } from "next/navigation";

export default function IndividualReviewRedirect() {
  redirect("/archive?view=review");
}
