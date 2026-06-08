import { z } from "zod";
import { User } from "../models/schemas.js";
import { verifyPassword } from "../lib/auth.js";
const Login = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});
export async function authRoutes(app) {
    app.post("/auth/login", async (req, reply) => {
        const body = Login.parse(req.body);
        const user = await User.findOne({ email: body.email }).lean();
        if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
            return reply.code(401).send({ error: "Invalid credentials" });
        }
        const token = await reply.jwtSign({
            sub: user._id,
            role: user.role,
            tenantId: user.tenantId ?? null,
        });
        return {
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId ?? null,
            },
        };
    });
}
