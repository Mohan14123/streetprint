import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { RegisterPage } from '../app/components/RegisterPage';
import * as authContext from '../auth/AuthContext';

const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual as any,
    useNavigate: () => mockNavigate,
  };
});

const mockRegister = vi.fn();
const mockUseAuth = vi.spyOn(authContext, 'useAuth');

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      login: vi.fn(),
      register: mockRegister,
      logout: vi.fn(),
      token: null,
      verifyEmail: vi.fn() as any,
      user: null,
      isLoading: false,
      error: null
    } as any);
  });

  it('should render the registration form', () => {
    render(
      <MemoryRouter>
        <RegisterPage onSwitchToLogin={vi.fn()} />
      </MemoryRouter>
    );
    
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Account/i })).toBeInTheDocument();
  });

  it('should show error if passwords do not match', async () => {
    render(
      <MemoryRouter>
        <RegisterPage onSwitchToLogin={vi.fn()} />
      </MemoryRouter>
    );
    
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/Confirm Password/i), { target: { value: 'differentpassword' } });
    
    const submitBtn = screen.getByRole('button', { name: /Create Account/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Passwords do not match/i)).toBeInTheDocument();
    });
  });
});
