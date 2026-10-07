import {fireEvent, render, screen} from '@testing-library/react';
import {useState} from 'react';
import {VisionSimulationDropDown} from '.';

const Harness = ({onChange}: {onChange: (name: string | undefined) => void}) => {
  const [name, setName] = useState<string | undefined>();
  return (
    <VisionSimulationDropDown
      simulationName={name}
      variant="toolbar"
      onChange={(next) => {
        setName(next);
        onChange(next);
      }}
    />
  );
};

const open = () => fireEvent.click(screen.getByTitle('Simulate vision'));

describe('VisionSimulationDropDown', () => {
  it('shows three kinds, one open at a time, and picks an option by its value', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    open();
    expect(screen.getByRole('button', {name: /Colour blindness/})).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText('Deuteranopia')).toBeInTheDocument();
    expect(screen.queryByText('Cataract')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /Eye conditions/}));
    expect(screen.queryByText('Deuteranopia')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: /Contrast loss/}));
    expect(onChange).toHaveBeenLastCalledWith('color-contrast-loss');

    // Reopened, the kind holding the active simulation is the one expanded.
    open();
    expect(screen.getByRole('button', {name: /Eye conditions/})).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    fireEvent.click(screen.getByRole('button', {name: 'Off — normal vision'}));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
