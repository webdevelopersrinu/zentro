import { Router } from "express";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/users/search?q=al
// Live username search for the invite box. Returns matching unique usernames
// (excluding yourself). Used when the creator searches people to invite.
router.get("/search", requireAuth, async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (!q) return res.json({ users: [] });

  const users = await User.find({
    username: { $regex: q, $options: "i" },
    _id: { $ne: req.user.id },
  })
    .select("username name avatarUrl")
    .limit(10);

  return res.json({
    users: users.map((u) => ({
      id: u._id,
      username: u.username,
      name: u.name || u.username,
      avatarUrl: u.avatarUrl || "",
    })),
  });
});

export default router;
