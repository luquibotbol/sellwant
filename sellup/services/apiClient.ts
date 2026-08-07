import { Event, Seller } from '@/store/eventStore';
import { User } from '@/store/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace with your actual backend URL
// If running locally, it might be http://localhost:PORT
// Ensure this is configurable (e.g., via environment variables)
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api'; // Example using Expo env var

interface ApiError {
  error: string;
}

// Store token retrieval logic (example using authStore's token)
// You might implement this differently, e.g., direct AsyncStorage access
async function getAuthToken(): Promise<string | null> {
   // Since apiClient is outside Zustand, direct access is tricky.
   // Option 1: Pass token explicitly to methods needing it.
   // Option 2: Use AsyncStorage directly here (if token is stored predictably).
   // Option 3: Create a separate token utility.
   // Let's try AsyncStorage direct access for simplicity, assuming the persist key is 'auth-storage'.
   try {
       const authStorage = await AsyncStorage.getItem('auth-storage');
       if (authStorage) {
           const { state } = JSON.parse(authStorage);
           return state?.sessionToken ?? null;
       }
       return null;
   } catch (e) {
       console.error("Error getting auth token from storage:", e);
       return null;
   }
}

// Helper function to handle API requests and errors
async function request<T>(endpoint: string, options: RequestInit = {}, includeAuth = false): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
  };

  if (includeAuth) {
      const token = await getAuthToken();
      if (token) {
          headers['Authorization'] = `Bearer ${token}`;
      } else {
          // Handle cases where auth is required but token is missing?
          console.warn(`Auth token missing for request to ${endpoint}`);
          // Depending on the endpoint, maybe throw an error earlier?
      }
  }
  options.headers = headers;


  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      let errorData: ApiError | { message: string } | string; // Handle Supabase error format too { message: ... }
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = response.statusText || 'An unknown error occurred';
      }

      const errorMessage = typeof errorData === 'string' ? errorData : ('error' in errorData ? errorData.error : errorData.message);
      console.error(`API Error (${response.status}) for ${options.method || 'GET'} ${url}: ${errorMessage}`);
      throw new Error(errorMessage || `HTTP error! status: ${response.status}`);
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
        return undefined as T;
    }

    return await response.json() as T;
  } catch (error) {
    console.error(`Network or processing error for ${options.method || 'GET'} ${url}:`, error);
    throw error; // Re-throw
  }
}

// --- Type Definitions for API Payloads/Responses ---
// Matches the structure expected/returned by the *backend*

// For POST /events
type CreateEventPayload = Omit<Event, 'id' | 'seller' | 'date' | 'category' | 'image' | 'tags'> & {
    category: string; // Backend expects category name
    image?: string; // Pass image url
    tags?: string[]; // Pass tags array
};

// For GET /events, GET /events/:id, POST /events, PUT /events/:id responses
interface EventApiResponse {
    event: Event; // Assumes backend maps perfectly to frontend Event type
}
interface EventsApiResponse {
    events: Event[];
}

// For POST /auth/signin response
interface SignInResponse {
    user: User; // Assumes backend maps to frontend User type
    session: {
        access_token: string;
        // Include other session properties if needed (refresh_token, expires_in, etc.)
    };
}

// For GET /auth/profile response
interface ProfileResponse {
    user: User;
}

// For PUT /auth/profile payload/response
type UpdateProfilePayload = Partial<User>; // Frontend User type fields
interface UpdateProfileResponse {
    user: User;
}

// For GET /categories response
interface Category {
    id: number;
    name: string;
    image: string;
}
interface CategoriesApiResponse {
    categories: Category[];
}


// --- API Client ---

export const apiClient = {
  events: {
    getAll: async (category?: string): Promise<EventsApiResponse> => {
      const endpoint = category ? `/events?category=${encodeURIComponent(category)}` : '/events';
      // Events are public, no auth needed? Assuming yes for now.
      return request<EventsApiResponse>(endpoint, {}, false);
    },
    getById: async (id: string): Promise<EventApiResponse> => {
       // Public? Assuming yes.
      return request<EventApiResponse>(`/events/${id}`, {}, false);
    },
    // Use the specific payload type
    create: async (eventData: CreateEventPayload): Promise<EventApiResponse> => {
      return request<EventApiResponse>('/events', {
        method: 'POST',
        body: JSON.stringify(eventData),
      }, true); // Auth required
    },
    // Use Partial<Event> for updates, backend maps fields
    update: async (id: string, eventData: Partial<Event>): Promise<EventApiResponse> => {
      return request<EventApiResponse>(`/events/${id}`, {
        method: 'PUT',
        body: JSON.stringify(eventData),
      }, true); // Auth required
    },
    delete: async (id: string): Promise<void> => {
      return request<void>(`/events/${id}`, { method: 'DELETE' }, true); // Auth required
    },
  },

  auth: {
    signIn: async (email: string, password: string): Promise<SignInResponse> => {
       return request<SignInResponse>('/auth/signin', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        }, false); // No auth needed to sign in
    },
    signOut: async (): Promise<void> => {
        // Include auth? Depends if backend /auth/signout needs it. Let's assume no for now.
        return request<void>('/auth/signout', { method: 'POST' }, false);
    },
    getProfile: async (): Promise<ProfileResponse> => {
        // Auth required to know *which* profile to get
        return request<ProfileResponse>('/auth/profile', {}, true);
    },
    updateProfile: async (userData: UpdateProfilePayload): Promise<UpdateProfileResponse> => {
         return request<UpdateProfileResponse>('/auth/profile', {
             method: 'PUT',
             body: JSON.stringify(userData),
         }, true); // Auth required
    },
  },

  categories: {
    getAll: async (): Promise<CategoriesApiResponse> => {
      // Public? Assuming yes.
      return request<CategoriesApiResponse>('/categories', {}, false);
    },
  }
};

// Note: Need to implement Auth and Category calls corresponding to routes in api.ts 