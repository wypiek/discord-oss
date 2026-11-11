import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Team as TeamEntity, TeamMember, User } from "@spacebar/database";
import { TeamCreateSchema, TeamMemberRole, TeamMemberState, Team } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        query: {
            include_payout_account_status: {
                type: "boolean",
                description: "Whether to include team payout account status in the response (default false)",
            },
        },
        responses: {
            200: {
                body: "TeamListResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const teams = await TeamEntity.find({
            where: {
                owner_user_id: req.user_id,
            },
            relations: { members: true },
        });

        res.send(teams);
    },
);

router.post(
    "/",
    route({
        requestBody: "TeamCreateSchema",
        responses: {
            200: {
                body: "Team",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const user = await User.findOneOrFail({
            where: { id: req.user_id },
            select: { mfa_enabled: true },
        });
        if (!user.mfa_enabled) throw new HTTPError("You must enable MFA to create a team");

        const body = req.body as TeamCreateSchema;

        const team = TeamEntity.create({
            name: body.name,
            owner_user_id: req.user_id,
        });
        await team.save();

        await TeamMember.create({
            user_id: req.user_id,
            team_id: team.id,
            membership_state: TeamMemberState.ACCEPTED,
            permissions: ["*"],
            role: TeamMemberRole.ADMIN,
        }).save();

        res.json(team.toJSON() satisfies Team);
    },
);

export default router;
