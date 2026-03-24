model SimpleCircuit "A simple resistor-capacitor circuit"

  Modelica.Electrical.Analog.Basic.Resistor R1(R=100)
    annotation(Placement(transformation(extent={{-40,20},{-20,40}})));

  Modelica.Electrical.Analog.Basic.Capacitor C1(C=1e-3)
    annotation(Placement(transformation(extent={{20,20},{40,40}})));

  Modelica.Electrical.Analog.Basic.Ground GND
    annotation(Placement(transformation(extent={{-10,-40},{10,-20}})));

  Modelica.Electrical.Analog.Sources.SineVoltage Vs(V=5, freqHz=50)
    annotation(Placement(transformation(
      extent={{-10,-10},{10,10}},
      rotation=270,
      origin={-60,10})));

equation
  connect(Vs.p, R1.p)
    annotation(Line(points={{-60,20},{-60,30},{-40,30}}, color={0,0,255}));
  connect(R1.n, C1.p)
    annotation(Line(points={{-20,30},{20,30}}, color={0,0,255}));
  connect(C1.n, GND.p)
    annotation(Line(points={{40,30},{60,30},{60,-10},{0,-10},{0,-20}}, color={0,0,255}));
  connect(Vs.n, GND.p)
    annotation(Line(points={{-60,0},{-60,-10},{0,-10},{0,-20}}, color={0,0,255}));

  annotation(
    Diagram(
      coordinateSystem(extent={{-100,-60},{100,60}}),
      graphics={
        Text(
          extent={{-90,55},{90,45}},
          textString="Simple RC Circuit",
          fontSize=10,
          textColor={0,0,128}
        )
      }
    ),
    Icon(
      coordinateSystem(extent={{-100,-100},{100,100}}),
      graphics={
        Rectangle(
          extent={{-100,-100},{100,100}},
          lineColor={0,0,127},
          fillColor={255,255,255},
          fillPattern=FillPattern.Solid
        ),
        Text(
          extent={{-100,-10},{100,10}},
          textString="%name",
          lineColor={0,0,127}
        )
      }
    )
  );

end SimpleCircuit;
