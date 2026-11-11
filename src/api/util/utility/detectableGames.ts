import { DetectableGames, DetectableGame } from "./games";

export async function getDetectableGames(): Promise<DetectableGame[]> {
    return (await DetectableGames.load()).games;
}

export async function getDetectableGamesById(ids: string[]) {
    const { byId } = await DetectableGames.load();
    return ids.map((id) => byId.get(id)).filter((game): game is DetectableGame => !!game);
}
