import { Octokit } from "@octokit/rest";

const DB_PATH = "movies.json";
// We need to know who the owner is. We'll fetch it on login.
// Repo name is assumed 'bluray' based on context, but we might want to make it configurable?
// For now, let's assume the user forks this or uses it in a repo named 'bluray'.
const REPO_NAME = "bluray";

export class GitHubClient {
    constructor(token) {
        this.octokit = new Octokit({ auth: token });
        this.token = token;
        this.owner = null;
    }

    async login() {
        try {
            const { data } = await this.octokit.rest.users.getAuthenticated();
            this.owner = data.login;
            return data;
        } catch (error) {
            console.error("Login failed", error);
            throw error;
        }
    }

    async getMovies() {
        if (!this.owner) await this.login();

        try {
            const { data } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: REPO_NAME,
                path: DB_PATH,
            });

            // Decode Base64 content
            const content = atob(data.content);
            const json = JSON.parse(content);
            return {
                movies: json.movies || [],
                sha: data.sha, // Needed for updates
                updated_at: json.updated_at
            };
        } catch (error) {
            console.error("Error fetching movies", error);
            // If file doesn't exist, return empty
            if (error.status === 404) return { movies: [], sha: null };
            throw error;
        }
    }

    async addMovie(movie) {
        if (!this.owner) await this.login();

        // 1. Get current state
        const { movies, sha } = await this.getMovies();

        // 2. Append new movie
        const newMovies = [...movies, movie];
        const newContent = JSON.stringify({
            updated_at: new Date().toISOString(),
            movies: newMovies
        }, null, 2);

        // 3. Commit
        await this.octokit.rest.repos.createOrUpdateFileContents({
            owner: this.owner,
            repo: REPO_NAME,
            path: DB_PATH,
            message: `Add movie: ${movie.title}`,
            content: btoa(newContent),
            sha: sha // undefined if new file
        });

        return newMovies;
    }
}
