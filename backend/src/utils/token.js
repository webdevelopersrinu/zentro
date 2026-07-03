import jwt from "jsonwebtoken";

// Creates a login token holding the user's id + username + display profile.
// Name & avatar ride along so the frontend can show them without an extra call.
export function signToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      username: user.username,
      name: user.name || user.username,
      avatarUrl: user.avatarUrl || "",
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// Verifies a token and returns its payload, or throws if invalid/expired.
export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}
