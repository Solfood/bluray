import { Octokit } from "@octokit/rest";

const DB_PATH = "movies.json";
// We need to know who the owner is. We'll fetch it on login.
// Repo name is assumed 'bluray' based on context, but we might want to make it configurable?
// For now, let's assume the user forks this or uses it in a repo named 'bluray'.
const REPO_NAME = "bluray";

const toBase64Utf8 = (value) => {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

const fromBase64Utf8 = (value) => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
};

const movieMatches = (a, b) => {
    if (!a || !b) return false;
    if (a.added_at && b.added_at && a.added_at === b.added_at) return true;
    if (a.upc && b.upc && a.upc === b.upc && a.title === b.title) return true;
    if (a.id != null && b.id != null && a.id === b.id && a.title === b.title) return true;
    return false;
};

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

            // Decode Base64 content (UTF-8 safe)
            const content = fromBase64Utf8(data.content);
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

    async addMovie(movie, retries = 3) {
        if (!this.owner) await this.login();

        try {
            // 1. Get current state (Fresh fetch)
            const { movies, sha } = await this.getMovies();

            // 2. Append new movie
            // Check for duplicates based on UPC to avoid double-add during retry
            if (movies.some(m => m.upc === movie.upc && m.title === movie.title)) {
                console.log("Movie already exists (likely from previous retry), skipping write.");
                return movies;
            }

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
                content: toBase64Utf8(newContent),
                sha: sha // undefined if new file
            });

            return newMovies;
        } catch (error) {
            // 409: Conflict (SHA mismatch)
            // 422: Validation Failed (often SHA related in GitHub API)
            if (retries > 0 && (error.status === 409 || error.status === 422)) {
                console.warn(`SHA Mismatch (Race Condition), retrying... attempts left: ${retries}`);
                await new Promise(r => setTimeout(r, 1000)); // Wait a sec for the other scanner/bot to finish
                return this.addMovie(movie, retries - 1);
            }
            throw error;
        }
    }

    async deleteMovie(movie, retries = 3) {
        if (!this.owner) await this.login();

        try {
            const { movies, sha } = await this.getMovies();
            const nextMovies = movies.filter((m) => !movieMatches(m, movie));

            if (nextMovies.length === movies.length) {
                console.warn("Delete skipped: movie not found in DB.");
                return movies;
            }

            const newContent = JSON.stringify({
                updated_at: new Date().toISOString(),
                movies: nextMovies
            }, null, 2);

            await this.octokit.rest.repos.createOrUpdateFileContents({
                owner: this.owner,
                repo: REPO_NAME,
                path: DB_PATH,
                message: `Remove movie: ${movie.title || movie.id || "unknown"}`,
                content: toBase64Utf8(newContent),
                sha: sha
            });

            return nextMovies;
        } catch (error) {
            if (retries > 0 && (error.status === 409 || error.status === 422)) {
                console.warn(`Delete conflict, retrying... attempts left: ${retries}`);
                await new Promise((r) => setTimeout(r, 1000));
                return this.deleteMovie(movie, retries - 1);
            }
            throw error;
        }
    }
}
